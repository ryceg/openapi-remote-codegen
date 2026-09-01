# OpenAPI Remote Extensions Specification

This document defines the `x-remote-*` vendor extensions that `openapi-remote-codegen` consumes. Any OpenAPI 3.x spec can include these extensions -- the codegen tool is backend-agnostic.

Operations **without** `x-remote-type` are ignored entirely. The codegen only processes operations that opt in.

## Extension Reference

### `x-remote-type`

| Property   | Value                          |
|------------|--------------------------------|
| Type       | `string` -- `"query"`, `"command"`, or `"form"` |
| Applied to | Operation                      |
| Required   | Yes (operations without it are skipped) |

Declares the operation's role in the generated code:

- **`query`** -- read operation. Generates a reactive `query()` wrapper that caches and deduplicates requests.
- **`command`** -- write operation. Generates a `command()` wrapper. Supports `x-remote-invalidates` to refresh stale queries after mutation.
- **`form`** -- write operation bound to a form. Generates a `form()` wrapper with schema validation and invalidation support. Same as `command` but integrated with form libraries.

```json
{
  "/api/v4/trackers": {
    "get": {
      "operationId": "Trackers_GetDefinitions",
      "tags": ["V4 Trackers"],
      "x-remote-type": "query"
    }
  }
}
```

### `x-remote-invalidates`

| Property   | Value                          |
|------------|--------------------------------|
| Type       | `string[]`                     |
| Applied to | Operation (only meaningful on `command` or `form`) |
| Required   | No (defaults to `[]`)          |

Lists query operations whose caches should be refreshed after this mutation succeeds. Entries can use short or fully-qualified names (see [Invalidation Resolution](#invalidation-resolution) below).

```json
{
  "/api/v4/trackers": {
    "post": {
      "operationId": "Trackers_Create",
      "tags": ["V4 Trackers"],
      "x-remote-type": "command",
      "x-remote-invalidates": ["GetDefinitions", "Trackers_GetActiveInstances"]
    }
  }
}
```

### `x-remote-batch`

| Property   | Value                          |
|------------|--------------------------------|
| Type       | `boolean`                      |
| Applied to | Operation (only meaningful on `query`) |
| Required   | No (defaults to `false`)       |

When `true`, generates a `query.batch()` wrapper instead of a plain `query()`. Batch queries accept multiple argument sets and execute them concurrently via `Promise.all`, returning a resolver function. This prevents N+1 request waterfalls when the same query is called many times in a render cycle.

Ignored on `command` and `form` operations.

```json
{
  "/api/v4/trackers/{id}": {
    "get": {
      "operationId": "Trackers_GetDefinition",
      "tags": ["V4 Trackers"],
      "x-remote-type": "query",
      "x-remote-batch": true,
      "parameters": [
        { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
      ]
    }
  }
}
```

### `x-client-property`

| Property   | Value                          |
|------------|--------------------------------|
| Type       | `string`                       |
| Applied to | Operation                      |
| Required   | No (falls back to tag-derived name) |

Overrides the property name used to access the API client. By default, the codegen derives the property from the tag (e.g., `V4 Trackers` becomes `trackers`). Use this when the generated client uses a different property name than the tag implies.

```json
{
  "/api/v4/foods": {
    "get": {
      "operationId": "Foods_GetFavorites",
      "tags": ["V4 Foods"],
      "x-remote-type": "query",
      "x-client-property": "foodsV4"
    }
  }
}
```

Generated code without override: `apiClient.foods.getFavorites()`
Generated code with override: `apiClient.foodsV4.getFavorites()`

## Invalidation Resolution

Each string in `x-remote-invalidates` is resolved to a target query function using one of two forms:

### Short name (same-tag resolution)

A bare method name like `"GetDefinitions"` resolves within the **same tag** as the mutating operation. The codegen lowercases the first character to produce the function name.

| Invalidation value | Current tag     | Resolved function | Resolved file     |
|--------------------|-----------------|-------------------|--------------------|
| `"GetDefinitions"` | `V4 Trackers`  | `getDefinitions`  | `trackers.generated.remote.ts` |
| `"GetFavorites"`   | `V4 Foods`     | `getFavorites`    | `foods.generated.remote.ts` |

### Fully-qualified name (cross-tag resolution)

A value containing an underscore like `"Trackers_GetActiveInstances"` is a full
`operationId` and is looked up against the spec. It may name a query under any tag.

| Invalidation value               | Resolved function      | Resolved from |
|----------------------------------|------------------------|---------------|
| `"Trackers_GetActiveInstances"`  | `getActiveInstances`   | the tag the spec gives that operation |
| `"MemberInvite_GetMembers"`      | `getMembers`           | the tag the spec gives that operation |

The target's tag comes from the operation the spec declares, not from the prefix.
A prefix is a controller name, while the tag decides the output file
(`V4 Member Invites` becomes `memberInvites.generated.remote.ts`), and the two
disagree often enough that reading the prefix would drop the reference.

When the target lives in another file, the generated file imports it:

```ts
import { getMembers } from './memberInvites.generated.remote.js';
```

An imported name is aliased (`getMembers as memberInvites_getMembers`) only when it
would collide with a function the file declares or with another import.

A name that resolves to nothing, or to an operation that is not a query, is skipped —
only a query can be refreshed.

## What a mutation refreshes

Query caches are keyed **per argument**, so one mutation emits up to two refreshes per
target:

```ts
await refreshInvalidated('update', [
  () => getBodyWeights(undefined).refresh(),
  () => requested(getBodyWeights, Infinity).refreshAll()
]);
```

- The **fixed key** the generator can name on its own. It is emitted when the query
  takes no path parameters (naming the no-argument key), or when the mutation can
  supply every path parameter the query takes, matched by name. A query keyed by path
  *and* query parameters together gets no fixed-key refresh, because the mutation
  cannot know the query half.
- `requested(fn, Infinity).refreshAll()`, which refreshes every cached key the client
  asked for. This is the only way to reach a subscription that passes arguments the
  mutation knows nothing about: `getBodyWeights({ count: 100, skip: 0 })` is not the
  key `getBodyWeights(undefined)` names. Call sites opt in by passing the query
  *function* to `.updates()`:

  ```ts
  await updateBodyWeight({ id, request }).updates(getBodyWeights);
  ```

  It costs nothing when the client asked for nothing, and the refreshed data rides
  back in the mutation's own response rather than in a second round-trip.

`.updates()` cannot be emitted by the generator — it is a method on the client-side
mutation promise, and the server wrapper throws if it is called there.

### Failure of a refresh never fails the mutation

`refreshInvalidated` (emitted into `invalidation.generated.ts`) runs the refreshes under
`Promise.allSettled`, so it cannot reject. A refresh runs only once the write has landed;
letting it reject would report a write that succeeded as failed — with a convincing reason
belonging to a different operation — and invite a retry that duplicates a non-idempotent
command.

Nothing is lost by swallowing there: SvelteKit awaits each refresh itself when it
serializes the response and reports a failed one against the query that failed, so the
subscription that went stale surfaces its own error while the mutation reports its own
outcome.

## Tag-to-File Mapping

Operations are grouped by their first tag into output files. The tag name is transformed as follows:

1. **Strip version prefix** -- remove leading `V` + digits + space (e.g., `V4 Trackers` becomes `Trackers`)
2. **Pluralize the last word** -- standard English rules: `y` to `ies`, `sh/ch/x/z` adds `es`, already-plural words unchanged
3. **camelCase multi-word tags** -- first word lowercase, subsequent words capitalized

| Tag                     | Output file                              |
|-------------------------|------------------------------------------|
| `V4 Trackers`           | `trackers.generated.remote.ts`           |
| `V4 Battery`            | `batteries.generated.remote.ts`          |
| `V4 Compression Lows`   | `compressionLows.generated.remote.ts`    |
| `V1 Connector Status`   | `connectorStatus.generated.remote.ts`    |
| `Note`                  | `notes.generated.remote.ts`              |

A barrel `index.ts` re-exports all generated files. When function names collide across tags, the barrel uses explicit named exports and omits the conflicting names.

## Complete Example

A realistic OpenAPI fragment demonstrating all four extensions together:

```json
{
  "openapi": "3.0.0",
  "info": { "title": "My API", "version": "1.0.0" },
  "paths": {
    "/api/v4/trackers": {
      "get": {
        "tags": ["V4 Trackers"],
        "operationId": "Trackers_GetDefinitions",
        "x-remote-type": "query",
        "parameters": [],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/TrackerDefinitionDto" }
                }
              }
            }
          }
        }
      },
      "post": {
        "tags": ["V4 Trackers"],
        "operationId": "Trackers_Create",
        "x-remote-type": "command",
        "x-remote-invalidates": ["GetDefinitions"],
        "parameters": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/CreateTrackerRequest" }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/TrackerDefinitionDto" }
              }
            }
          }
        }
      }
    },
    "/api/v4/trackers/{id}": {
      "get": {
        "tags": ["V4 Trackers"],
        "operationId": "Trackers_GetDefinition",
        "x-remote-type": "query",
        "x-remote-batch": true,
        "x-client-property": "trackers",
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/TrackerDefinitionDto" }
              }
            }
          }
        }
      },
      "delete": {
        "tags": ["V4 Trackers"],
        "operationId": "Trackers_DeleteDefinition",
        "x-remote-type": "command",
        "x-remote-invalidates": ["GetDefinitions"],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string", "format": "uuid" } }
        ],
        "responses": {
          "204": { "description": "No content" }
        }
      }
    },
    "/api/v4/trackers/favorites": {
      "post": {
        "tags": ["V4 Trackers"],
        "operationId": "Trackers_AddFavorite",
        "x-remote-type": "form",
        "x-remote-invalidates": ["GetDefinitions"],
        "parameters": [],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/AddFavoriteRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Success",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/TrackerDefinitionDto" }
              }
            }
          }
        }
      }
    }
  }
}
```

This produces a single file `trackers.generated.remote.ts` with:

- `getDefinitions` -- `query()`, no params
- `create` -- `command()`, invalidates `getDefinitions`
- `getDefinition` -- `query.batch()`, takes `id`
- `deleteDefinition` -- `command()`, void response, invalidates `getDefinitions`
- `addFavorite` -- `form()`, invalidates `getDefinitions`
