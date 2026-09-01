import type { OperationInfo } from '../types.js';
import { operationIdToFunctionName, tagToFileName } from './naming.js';

/** A query one mutation refreshes, resolved against the spec. */
export interface InvalidationTarget {
  /** The query the `Invalidates` entry named. */
  operation: OperationInfo;
  /** Identifier the emitting file uses to reach the query function. */
  localName: string;
  /**
   * Module the query is exported from, when it lives in another tag's file.
   * Undefined for a query declared in the emitting file.
   */
  importFrom?: string;
  /** The name that module exports, when {@link localName} is an alias for it. */
  exportedName?: string;
}

/** The imports and per-operation refresh statements one generated file needs. */
export interface FileInvalidationPlan {
  /** Import lines for queries this file refreshes but does not declare. */
  importLines: string[];
  /** Refresh targets per declaring operationId, empty for operations with none. */
  targetsByOperationId: Map<string, InvalidationTarget[]>;
  /** Whether any emitted refresh needs `requested` from the server module. */
  usesRequested: boolean;
}

/**
 * Resolve one `Invalidates` entry to the query it names.
 *
 * A bare name ("GetNotes") names a query in the declaring operation's own tag.
 * A qualified name ("Trackers_GetActiveInstances") is a full operationId and may
 * name a query under any tag. The target's tag is read off the operation the spec
 * declares rather than off the prefix: a prefix is the C# controller name, while
 * the tag is what decides the generated file ("V4 Member Invites" -> memberInvites),
 * and the two disagree often enough that guessing drops the reference.
 *
 * Only queries resolve. A command cannot be refreshed, so naming one is a
 * declaration error rather than something to emit an uncallable `.refresh()` for.
 */
export function resolveInvalidationTarget(
  invalidate: string,
  declaringOp: OperationInfo,
  allOperations: OperationInfo[]
): OperationInfo | undefined {
  if (invalidate.includes('_')) {
    return allOperations.find(
      (op) => op.operationId === invalidate && op.remoteType === 'query'
    );
  }

  const functionName = operationIdToFunctionName(invalidate);
  return allOperations.find(
    (op) =>
      op.tag === declaringOp.tag &&
      op.remoteType === 'query' &&
      operationIdToFunctionName(op.operationId) === functionName
  );
}

/**
 * Resolve every `Invalidates` declaration in one tag, and name the queries that
 * live elsewhere.
 *
 * An imported name is aliased only when it would collide — with a function the
 * file declares itself, or with another import — so the common case stays
 * readable and the ambiguous case stays unambiguous.
 */
export function planFileInvalidations(
  tag: string,
  operations: OperationInfo[],
  allOperations: OperationInfo[]
): FileInvalidationPlan {
  const declaredNames = new Set(
    operations.map((op) => operationIdToFunctionName(op.operationId))
  );

  /** operationId of an imported query -> the name this file calls it by. */
  const importedNames = new Map<string, string>();
  /** module specifier -> import clauses, in first-seen order. */
  const importsByModule = new Map<string, string[]>();
  const takenNames = new Set(declaredNames);

  const targetsByOperationId = new Map<string, InvalidationTarget[]>();
  let usesRequested = false;

  for (const op of operations) {
    const targets: InvalidationTarget[] = [];

    for (const invalidate of op.invalidates) {
      const target = resolveInvalidationTarget(invalidate, op, allOperations);
      if (!target) continue;

      const exportedName = operationIdToFunctionName(target.operationId);

      if (target.tag === tag) {
        targets.push({ operation: target, localName: exportedName });
        usesRequested = true;
        continue;
      }

      const module = `./${tagToFileName(target.tag)}.generated.remote.js`;
      let localName = importedNames.get(target.operationId);

      if (localName === undefined) {
        localName = exportedName;
        if (takenNames.has(localName)) {
          localName = `${tagToFileName(target.tag)}_${exportedName}`;
        }
        takenNames.add(localName);
        importedNames.set(target.operationId, localName);

        const clause =
          localName === exportedName ? exportedName : `${exportedName} as ${localName}`;
        const clauses = importsByModule.get(module) ?? [];
        clauses.push(clause);
        importsByModule.set(module, clauses);
      }

      targets.push({
        operation: target,
        localName,
        importFrom: module,
        exportedName,
      });
      usesRequested = true;
    }

    targetsByOperationId.set(op.operationId, targets);
  }

  const importLines = Array.from(importsByModule, ([module, clauses]) =>
    `import { ${clauses.join(', ')} } from '${module}';`
  );

  return { importLines, targetsByOperationId, usesRequested };
}

/**
 * The refresh expressions for one mutation, as thunks for
 * `refreshInvalidated` to run.
 *
 * Each target contributes up to two, because they cover different cache keys:
 *
 * - A **fixed-key** `fn(arg).refresh()`, emitted only when the mutation can
 *   supply every path parameter the query takes. It refreshes the one key the
 *   generator can name without the client's help, so a subscription that passes
 *   exactly that argument updates whether or not the call site opted in.
 * - `requested(fn, Infinity).refreshAll()`, which refreshes every *cached* key
 *   the client asked for by passing the query function to `.updates()`. Query
 *   keys are per-argument, so this is the only way a mutation can reach a
 *   subscription that passes query parameters the mutation knows nothing about
 *   — `getBodyWeights({ count: 100, skip: 0 })` is not the key
 *   `getBodyWeights(undefined)` names. It costs nothing when the client asked
 *   for nothing.
 */
export function refreshThunks(
  declaringOp: OperationInfo,
  targets: InvalidationTarget[]
): string[] {
  const availablePathParams = new Set(
    declaringOp.parameters.filter((p) => p.in === 'path').map((p) => p.name)
  );

  const thunks: string[] = [];

  for (const target of targets) {
    const fixedKeyArg = fixedKeyArgument(target.operation, availablePathParams);
    if (fixedKeyArg !== undefined) {
      thunks.push(`() => ${target.localName}(${fixedKeyArg}).refresh()`);
    }
    thunks.push(`() => requested(${target.localName}, Infinity).refreshAll()`);
  }

  return thunks;
}

/**
 * The argument a fixed-key refresh passes the query, or undefined when the
 * mutation cannot name a key the client would actually hold.
 *
 * The expression has to be what the query's own generated signature accepts, so
 * this mirrors the shapes `buildParameterMapping` emits:
 *
 * - No parameters, or query parameters only — the query's argument is optional,
 *   so `undefined` names the key held by a subscription that passes no argument.
 *   Subscriptions that do pass query parameters are the argument gap that
 *   `requested(...).refreshAll()` covers.
 * - One path parameter and nothing else — passed bare.
 * - Several path parameters and nothing else — passed as an object.
 *
 * A query taking path parameters is keyed by them, so the mutation must supply
 * every one from its own path parameters, matched by name; supplying only some
 * would refresh a key nobody holds. A query mixing path and query parameters is
 * keyed by both together, and the mutation cannot know the query half, so it
 * gets no fixed-key refresh at all.
 */
function fixedKeyArgument(
  target: OperationInfo,
  availablePathParams: ReadonlySet<string>
): string | undefined {
  const pathParams = target.parameters.filter((p) => p.in === 'path');
  const queryParams = target.parameters.filter((p) => p.in === 'query');

  if (pathParams.length === 0) return 'undefined';
  if (queryParams.length > 0) return undefined;
  if (!pathParams.every((p) => availablePathParams.has(p.name))) return undefined;
  if (pathParams.length === 1) return pathParams[0].name;

  return `{ ${pathParams.map((p) => p.name).join(', ')} }`;
}
