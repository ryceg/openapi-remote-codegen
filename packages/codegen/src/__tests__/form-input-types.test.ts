import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { generateRemoteFunctions } from '../generators/remote-functions.js';
import { resolveConfig } from '../config.js';
import type { ParsedSpec } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Copied verbatim from SvelteKit 3.1.0's `$app/server` declarations: what form() checks a schema's
// input against. Kept here rather than imported so the package needs no SvelteKit to test.
const APP_SERVER = `
declare module '$app/server' {
  type MaybeArray<T> = T | T[];
  type IsAny<T> = 0 extends 1 & T ? true : false;
  export interface RemoteFormInput {
    [key: string]: MaybeArray<string | number | boolean | File | RemoteFormInput> | undefined;
  }
  export type HasNonOptionalBoolean<T> =
    IsAny<T> extends true
      ? never
      : [T] extends [boolean]
        ? true
        : T extends Array<infer U>
          ? HasNonOptionalBoolean<U>
          : T extends Record<string, any>
            ? { [K in keyof T]: HasNonOptionalBoolean<T[K]> }[keyof T]
            : never;
}
`;

const ASSERTIONS = `
import { z } from 'zod';
import type { RemoteFormInput, HasNonOptionalBoolean } from '$app/server';
import { formCoerce } from './form-utils.generated.js';

type InputOf<S extends z.ZodType> = ReturnType<typeof formCoerce<S>> extends z.ZodType<any, infer I> ? I : never;
type Accepted<S extends z.ZodType> = [InputOf<S>] extends [RemoteFormInput] ? true : false;
type Refused<S extends z.ZodType> = true extends HasNonOptionalBoolean<InputOf<S>> ? true : false;

const nullish = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined);

const record = z.strictObject({
  when: z.iso.datetime({ offset: true }).optional(),
  note: nullish(z.string()).optional(),
  units: z.number().optional(),
  kind: nullish(z.enum(['a', 'b'])).optional(),
  extra: nullish(z.object({}).catchall(z.unknown())).optional(),
  nested: nullish(z.object({ flag: z.boolean().optional(), at: z.date().optional() })).optional(),
  list: nullish(z.array(z.object({ hours: z.number(), label: nullish(z.string()) }))).optional(),
  only: z.null().optional(),
  isFavorite: nullish(z.boolean()).optional(),
});

const withRequiredBoolean = z.object({ id: z.string(), done: z.boolean() });
const withNestedRequiredBoolean = z.object({ items: z.array(z.object({ on: z.boolean(), x: nullish(z.string()) })) });
const withRequiredNull = z.object({ id: z.string(), n: z.null() });

const accepted: Accepted<typeof record> = true;
const optionalBooleansPass: Refused<typeof record> = false;
const requiredBoolean: Refused<typeof withRequiredBoolean> = true;
const nestedRequiredBoolean: Refused<typeof withNestedRequiredBoolean> = true;
const requiredNullIsNoBoolean: Refused<typeof withRequiredNull> = false;
void [accepted, optionalBooleansPass, requiredBoolean, nestedRequiredBoolean, requiredNullIsNoBoolean];
`;

const parsed: ParsedSpec = {
  operations: [
    {
      operationId: 'Signups_Begin',
      tag: 'Signups',
      method: 'post',
      path: '/api/signups/begin',
      remoteType: 'form',
      invalidates: [],
      parameters: [],
      isVoidResponse: false,
      clientPropertyName: 'signups',
    },
  ],
  tags: ['Signups'],
};

// Compiles the emitted form-utils against SvelteKit's own form() input checks, so a regression in
// the input mapping shows as a type error rather than as a form SvelteKit refuses in a consumer.
describe('typed formCoerce input', () => {
  it('is a form payload for a schema holding nulls, dates and unknowns, and still refuses a required boolean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'remote-codegen-types-'));
    try {
      const files = generateRemoteFunctions(parsed, resolveConfig({ typedSchemas: true }));
      writeFileSync(join(dir, 'form-utils.generated.ts'), files.get('form-utils.generated.ts')!);
      writeFileSync(join(dir, 'app-server.d.ts'), APP_SERVER);
      writeFileSync(join(dir, 'assertions.ts'), ASSERTIONS);
      symlinkSync(resolve(here, '../../node_modules'), join(dir, 'node_modules'), 'junction');
      writeFileSync(
        join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            lib: ['ES2022', 'DOM'],
            types: [],
          },
          files: ['app-server.d.ts', 'assertions.ts'],
        })
      );

      const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
      const result = spawnSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf-8' });

      expect(result.stdout + result.stderr).toBe('');
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
