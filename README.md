# openapi-remote-codegen

Generate type-safe SvelteKit remote functions from OpenAPI specs.

Annotate your backend endpoints with `x-remote-*` extensions, and the codegen produces `query()`, `command()`, and `form()` wrappers with automatic error handling, cache invalidation, and Zod validation.

## Packages

| Package | Description |
|---------|-------------|
| [`openapi-remote-codegen`](packages/codegen/) | TypeScript codegen CLI and library |
| [`OpenApi.Remote.Attributes`](attributes/dotnet/) | .NET attributes + NSwag processor |

## Quick Start

### Frontend (codegen)

```bash
npm install -D openapi-remote-codegen
npx openapi-remote-codegen
```

### Backend (.NET)

```bash
dotnet add package OpenApi.Remote.Attributes
```

```csharp
[RemoteQuery]
[HttpGet("items")]
public async Task<ItemDto[]> GetItems() { ... }

[RemoteCommand(Invalidates = new[] { "GetItems" })]
[HttpPost("items")]
public async Task<ItemDto> CreateItem([FromBody] CreateItemRequest request) { ... }
```

### Other Backends

See [Extension Specification](docs/extension-spec.md) for the `x-remote-*` OpenAPI extension format.

## License

MIT
