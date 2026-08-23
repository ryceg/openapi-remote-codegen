# openapi-remote-codegen

TypeScript CLI and library that generates type-safe SvelteKit remote functions from OpenAPI specs annotated with `x-remote-*` extensions.

## Installation

```bash
npm install -D openapi-remote-codegen
```

## Zero-Config Usage

If your OpenAPI spec lives at `./openapi.json`, just run:

```bash
npx openapi-remote-codegen
```

The generator reads the spec, finds operations annotated with `x-remote-type`, and writes generated files to `./src/lib/api/generated/`.

## Configuration

Create a `remote-codegen.config.ts` (or `.js` / `.mjs`) in your project root:

```ts
import { defineConfig } from 'openapi-remote-codegen/config';

export default defineConfig({
  openApiPath: './openapi.json',
  outputDir: './src/lib',
});
```

### Config Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `openApiPath` | `string` | `'./openapi.json'` | Path to the OpenAPI spec JSON file |
| `outputDir` | `string` | `'./src/lib'` | Base output directory for generated files |
| `remoteFunctionsOutput` | `string` | `'api/generated'` | Subdirectory within `outputDir` for remote function files |
| `apiClientOutput` | `string` | `'api/api-client.generated.ts'` | Path within `outputDir` for the ApiClient wrapper |
| `clientAccess` | `string` | `'getRequestEvent().locals.apiClient'` | Expression to access the API client in generated functions |
| `nswagClientPath` | `string` | `'./generated/api-client'` | Path to the NSwag-generated client module |
| `imports` | `ImportPaths` | See below | Module paths used in generated `import` statements |
| `errorHandling` | `ErrorHandling` | See below | Templates for generated `catch` blocks |

### `imports`

| Key | Default | Description |
|-----|---------|-------------|
| `server` | `'$app/server'` | Module providing `query`, `command`, `form`, `getRequestEvent` |
| `kit` | `'@sveltejs/kit'` | Module providing `error`, `redirect` |
| `schemas` | `'$lib/api/generated/schemas'` | Module providing Zod schemas |
| `apiTypes` | `'$api'` | Module providing API types and enums |
| `zod` | `'zod'` | Zod module |

### `errorHandling`

| Key | Default | Description |
|-----|---------|-------------|
| `on401` | Redirect to `/auth/login` | Code to execute on 401 (has access to `url`) |
| `on403` | `error(403, 'Forbidden')` | Code to execute on 403 |
| `on500` | `error(500, 'Failed to ...')` | Function taking a human-readable name, returns code for 500 |

## CLI Flags

```bash
npx openapi-remote-codegen [options]

Options:
  --config <path>    Path to config file (skips auto-discovery)
```

### Config File Discovery

When `--config` is not provided, the CLI looks for these files in the current directory (first match wins):

1. `remote-codegen.config.ts`
2. `remote-codegen.config.js`
3. `remote-codegen.config.mjs`

If none are found, all defaults apply.

## Generated Output

The generator produces one file per OpenAPI tag (e.g., `foods.generated.remote.ts`) plus an `index.ts` barrel export and an `api-client.generated.ts` wrapper. Stale generated files are automatically cleaned up.

### Example: Query

```ts
// foods.generated.remote.ts
import { query, getRequestEvent } from '$app/server';
import { error, redirect } from '@sveltejs/kit';

export const getFavorites = query(async () => {
  try {
    const apiClient = getRequestEvent().locals.apiClient;
    return await apiClient.foodsV4.getFavorites();
  } catch (err) {
    const status = (err as any)?.status;
    if (status === 401) { /* redirect to login */ }
    if (status === 403) throw error(403, 'Forbidden');
    throw error(500, 'Failed to get favorites');
  }
});
```

### Example: Command with Invalidation

```ts
export const createFood = command(async (data: CreateFoodDto) => {
  try {
    const apiClient = getRequestEvent().locals.apiClient;
    return await apiClient.foodsV4.createFood(data);
  } catch (err) {
    // ... error handling
  }
}, { invalidates: [getFavorites] });
```

### Example: File Upload

Operations whose request body is `multipart/form-data` carrying an `IFormFile` always
generate a `form()` remote, whatever `x-remote-type` they declare. A `command()` cannot
carry a file: its arguments are devalue-serialised, and devalue throws on a `File` in the
browser before any request is sent. Callers submit a `<form>` with a file input named
after the field (`file` by default).

```ts
export const upload = form('unchecked', async (data: { file?: File }) => {
  const apiClient = getRequestEvent().locals.apiClient;
  const submitted = data.file;
  if (!submitted) throw error(400, 'No file was submitted');
  // A submitted file arrives as SvelteKit's lazy proxy, which multipart encoders
  // reject; read it into a real File before attaching it.
  const file = new File([await submitted.arrayBuffer()], submitted.name, { type: submitted.type });
  // ... builds FormData and POSTs it through the API client's HTTP client
});
```

```svelte
<form {...upload}>
  <input type="file" name="file" />
  <button>Upload</button>
</form>
```

## Programmatic API

The package also exports its core pipeline for integration into build tools or custom workflows:

```ts
import {
  parseOpenApiSpec,
  generateRemoteFunctions,
  generateApiClient,
  resolveConfig,
  defineConfig,
} from 'openapi-remote-codegen';
```

```ts
import { readFileSync } from 'fs';
import { resolveConfig, parseOpenApiSpec, generateRemoteFunctions } from 'openapi-remote-codegen';

const config = resolveConfig({ openApiPath: './my-spec.json' });
const spec = JSON.parse(readFileSync(config.openApiPath, 'utf-8'));
const parsed = parseOpenApiSpec(spec);
const files = generateRemoteFunctions(parsed, config);

for (const [fileName, content] of files) {
  console.log(fileName, content.length);
}
```

### Exported Types

```ts
import type {
  GeneratorConfig,
  UserConfig,
  ImportPaths,
  ErrorHandling,
  ParsedSpec,
  OperationInfo,
  ParameterInfo,
  RemoteType,
} from 'openapi-remote-codegen';
```

## How It Works

1. **Parse** -- The OpenAPI JSON spec is read and scanned for operations containing `x-remote-type` extension data.
2. **Classify** -- Each annotated operation is classified as a `query`, `command`, or `form` and its parameters, request body schema, and response type are extracted.
3. **Generate** -- Operations are grouped by tag. For each tag, a `.generated.remote.ts` file is emitted with typed wrapper functions. An `ApiClient` wrapper and barrel `index.ts` are also generated.
4. **Write** -- Files are written to the configured output directory. Previously generated files that no longer correspond to a tag are removed.

## License

MIT
