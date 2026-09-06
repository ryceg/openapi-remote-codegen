import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRemoteFunctions } from '../generators/remote-functions.js';
import { generateRemoteErrorFile } from '../generators/remote-error.js';
import { resolveConfig } from '../config.js';
import type { OperationInfo, ParsedSpec } from '../types.js';

const parsed: ParsedSpec = {
  operations: [
    {
      operationId: 'Foods_GetFavorites',
      tag: 'V4 Foods',
      method: 'get',
      path: '/api/v4/foods/favorites',
      remoteType: 'query',
      invalidates: [],
      parameters: [],
      isVoidResponse: false,
      clientPropertyName: 'foodsV4',
    } satisfies OperationInfo,
  ],
  tags: ['V4 Foods'],
};

describe('shared error module emission', () => {
  it('emits remote-error.generated.ts alongside the tag files', () => {
    const files = generateRemoteFunctions(parsed, resolveConfig({}));
    expect(files.has('remote-error.generated.ts')).toBe(true);
  });

  it('delegates the catch block to the shared helpers', () => {
    const content = generateRemoteFunctions(parsed, resolveConfig({}))
      .get('foods.generated.remote.ts')!;

    expect(content).toContain("import { remoteErrorMessage, translateRemoteError } from './remote-error.generated.js';");
    expect(content).toContain("if (status === 403) { throw error(403, remoteErrorMessage(err, 'Forbidden')); }");
    expect(content).toContain("throw translateRemoteError(err, 'Failed to get favorites');");
    expect(content).not.toContain('JSON.parse');
  });

  it('omits the module and its import when no arm names it', () => {
    const files = generateRemoteFunctions(parsed, resolveConfig({
      errorHandling: {
        on401: "throw error(401, 'Unauthorized')",
        on403: "throw error(403, 'Forbidden')",
        on500: (fn) => `throw error(500, 'Failed to ${fn}')`,
      },
    }));

    expect(files.has('remote-error.generated.ts')).toBe(false);
    expect(files.get('foods.generated.remote.ts')!).not.toContain('remote-error.generated.js');
  });

  it('imports only the helpers a custom arm names', () => {
    const content = generateRemoteFunctions(parsed, resolveConfig({
      errorHandling: {
        on403: "throw error(403, remoteErrorMessage(err, 'Nope'))",
        on500: (fn) => `throw error(500, 'Failed to ${fn}')`,
      },
    })).get('foods.generated.remote.ts')!;

    expect(content).toContain("import { remoteErrorMessage } from './remote-error.generated.js';");
    expect(content).not.toContain('translateRemoteError');
  });

  it('bakes the configured forward statuses into the module', () => {
    const content = generateRemoteErrorFile(resolveConfig({
      errorHandling: { forwardStatuses: [400, 422] },
    }));

    expect(content).toContain('new Set([400, 422])');
  });

  it('forwards 400, 409 and 429 by default', () => {
    const content = generateRemoteErrorFile(resolveConfig({}));
    expect(content).toContain('new Set([400, 409, 429])');
  });
});

describe('emitted error translation', () => {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '__generated__');
  let remoteErrorMessage: (err: unknown, fallback: string) => string;
  let translateRemoteError: (err: unknown, fallback: string) => never;

  /** An error shaped exactly as NSwag's ApiException throws it. */
  function apiException(status: number, response: string) {
    return {
      message: 'An unexpected server error occurred.',
      status,
      response,
      headers: {},
      result: null,
      isApiException: true,
    };
  }

  function thrownBy(run: () => never): { status: number; body: { message: string } } {
    try {
      run();
    } catch (err) {
      return err as { status: number; body: { message: string } };
    }
    throw new Error('expected a throw');
  }

  beforeAll(async () => {
    mkdirSync(outDir, { recursive: true });
    const config = resolveConfig({ imports: { kit: '../fixtures/kit-stub.js' } });
    writeFileSync(resolve(outDir, 'remote-error.generated.ts'), generateRemoteErrorFile(config), 'utf-8');
    const module = await import('./__generated__/remote-error.generated.js');
    remoteErrorMessage = module.remoteErrorMessage;
    translateRemoteError = module.translateRemoteError;
  });

  it('parses an ApiException whose response is a JSON string body', () => {
    const err = apiException(409, JSON.stringify({ error: 'Slug taken' }));
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('Slug taken');
  });

  it('prefers ProblemDetails detail over title', () => {
    const err = apiException(400, JSON.stringify({ title: 'Bad Request', detail: 'Slug is reserved', status: 400 }));
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('Slug is reserved');
  });

  it('flattens validation errors', () => {
    const err = apiException(400, JSON.stringify({ errors: { slug: ['required'] } }));
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('required');
  });

  it('joins several validation errors', () => {
    const err = apiException(400, JSON.stringify({ errors: { slug: ['required', 'too short'], email: ['invalid'] } }));
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('required, too short; invalid');
  });

  it('falls back when the body is not JSON', () => {
    const err = apiException(500, '<html>502 Bad Gateway</html>');
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('Failed to sign up');
  });

  it('never surfaces the client library boilerplate message', () => {
    const err = apiException(500, '');
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('Failed to sign up');
  });

  it('reads a deserialized object result directly', () => {
    const err = { ...apiException(403, ''), result: { detail: 'Not an administrator' } };
    expect(remoteErrorMessage(err, 'Forbidden')).toBe('Not an administrator');
  });

  it('reads a ProblemDetails thrown directly, without an exception wrapper', () => {
    const err = { status: 400, title: 'Bad Request', detail: 'Slug is reserved' };
    expect(remoteErrorMessage(err, 'Failed to sign up')).toBe('Slug is reserved');
  });

  it('forwards a configured status with the server reason', () => {
    const err = apiException(409, JSON.stringify({ error: 'Slug taken' }));
    expect(thrownBy(() => translateRemoteError(err, 'Failed to sign up'))).toEqual({
      status: 409,
      body: { message: 'Slug taken' },
    });
  });

  it('collapses an unforwarded status to 500 but keeps the server reason', () => {
    const err = apiException(404, JSON.stringify({ detail: 'No such tenant' }));
    expect(thrownBy(() => translateRemoteError(err, 'Failed to sign up'))).toEqual({
      status: 500,
      body: { message: 'No such tenant' },
    });
  });
});
