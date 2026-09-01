export interface ImportPaths {
  /** Module providing query, command, form, getRequestEvent. Default: '$app/server' */
  server: string;
  /** Module providing error, redirect. Default: '@sveltejs/kit' */
  kit: string;
  /** Module providing Zod schemas. Default: '$lib/api/generated/schemas' */
  schemas: string;
  /** Module providing API types/enums. Default: '$api' */
  apiTypes: string;
  /** Zod module. Default: 'zod' */
  zod: string;
}

/**
 * The remote-function kind a catch block is being generated for. SvelteKit
 * forbids `redirect(...)` inside `command()` and `form()` handlers — they must
 * return a result and let the client navigate. Queries may redirect freely.
 */
export type RemoteKind = 'query' | 'command' | 'form';

export interface ErrorHandling {
  /**
   * Code to execute on 401. Has access to `url` (current URL).
   *
   * Accepts a string (used in every catch block) or a function that receives
   * the {@link RemoteKind} and returns kind-specific code. Default: queries
   * redirect to `/auth/login`; commands and forms throw `error(401)` because
   * SvelteKit rejects redirects from those handlers at runtime.
   */
  on401: string | ((kind: RemoteKind) => string);
  /**
   * Code to execute on 403. Emitted inside a block, so it may span statements —
   * an arm that has to inspect the thrown value before deciding needs the room.
   * Default: error(403, 'Forbidden')
   */
  on403: string;
  /** Function that takes a human-readable function name and returns code for 500. */
  on500: (functionName: string) => string;
  /**
   * Import lines emitted into every generated remote file, for helpers the arms
   * call. The arms are code spliced into a catch block, so anything they name
   * beyond `err` and `status` has to be imported here.
   */
  imports: string[];
}

/** Resolve {@link ErrorHandling.on401} to a string for a given remote kind. */
export function resolveOn401(handler: ErrorHandling['on401'], kind: RemoteKind): string {
  return typeof handler === 'function' ? handler(kind) : handler;
}

export interface GeneratorConfig {
  /** Path to the OpenAPI spec JSON file. Default: './openapi.json' */
  openApiPath: string;
  /** Base output directory. Default: './src/lib' */
  outputDir: string;
  /** Subdirectory within outputDir for remote function files. Default: 'api/generated' */
  remoteFunctionsOutput: string;
  /** Path within outputDir for the ApiClient wrapper. Default: 'api/api-client.generated.ts' */
  apiClientOutput: string;
  /** Import paths used in generated code. */
  imports: ImportPaths;
  /** Expression to access the API client in generated functions. Default: 'getRequestEvent().locals.apiClient' */
  clientAccess: string;
  /** Error handling templates for generated catch blocks. */
  errorHandling: ErrorHandling;
  /** Path to the NSwag-generated client module (used in ApiClient imports). Default: './generated/api-client' */
  nswagClientPath: string;
}

export type UserConfig = Partial<Omit<GeneratorConfig, 'imports' | 'errorHandling'>> & {
  imports?: Partial<ImportPaths>;
  errorHandling?: Partial<ErrorHandling>;
};

const DEFAULT_IMPORTS: ImportPaths = {
  server: '$app/server',
  kit: '@sveltejs/kit',
  schemas: '$lib/api/generated/schemas',
  apiTypes: '$api',
  zod: 'zod',
};

const DEFAULT_ERROR_HANDLING: ErrorHandling = {
  on401: (kind) =>
    kind === 'query'
      ? 'const { url } = getRequestEvent(); throw redirect(302, `/auth/login?returnUrl=${encodeURIComponent(url.pathname + url.search)}`)'
      : "throw error(401, 'Unauthorized')",
  on403: "throw error(403, 'Forbidden')",
  on500: (functionName: string) => `throw error(500, 'Failed to ${functionName}')`,
  imports: [],
};

const DEFAULTS: GeneratorConfig = {
  openApiPath: './openapi.json',
  outputDir: './src/lib',
  remoteFunctionsOutput: 'api/generated',
  apiClientOutput: 'api/api-client.generated.ts',
  imports: DEFAULT_IMPORTS,
  clientAccess: 'getRequestEvent().locals.apiClient',
  errorHandling: DEFAULT_ERROR_HANDLING,
  nswagClientPath: './generated/api-client',
};

/** Type-helper for config files. Returns the input as-is. */
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}

/** Merge user config with defaults to produce a fully resolved config. */
export function resolveConfig(user: UserConfig): GeneratorConfig {
  return {
    openApiPath: user.openApiPath ?? DEFAULTS.openApiPath,
    outputDir: user.outputDir ?? DEFAULTS.outputDir,
    remoteFunctionsOutput: user.remoteFunctionsOutput ?? DEFAULTS.remoteFunctionsOutput,
    apiClientOutput: user.apiClientOutput ?? DEFAULTS.apiClientOutput,
    imports: {
      ...DEFAULTS.imports,
      ...user.imports,
    },
    clientAccess: user.clientAccess ?? DEFAULTS.clientAccess,
    errorHandling: {
      ...DEFAULTS.errorHandling,
      ...user.errorHandling,
    },
    nswagClientPath: user.nswagClientPath ?? DEFAULTS.nswagClientPath,
  };
}
