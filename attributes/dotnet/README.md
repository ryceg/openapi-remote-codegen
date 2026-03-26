# OpenApi.Remote.Attributes

C# attributes and NSwag operation processor for emitting `x-remote-*` OpenAPI extensions consumed by [openapi-remote-codegen](../../packages/codegen/).

Instead of hand-editing your OpenAPI spec, annotate your ASP.NET Core controllers and the processor writes the extensions into the generated spec automatically.

## Installation

```bash
dotnet add package OpenApi.Remote.Attributes
```

## NSwag Registration

Register the operation processor wherever you configure NSwag:

```csharp
using OpenApi.Remote.Processors;

services.AddOpenApiDocument(settings =>
{
    settings.OperationProcessors.Add(new RemoteFunctionOperationProcessor());
});
```

The processor inspects each endpoint for `Remote*` attributes and emits the corresponding `x-remote-type`, `x-remote-invalidates`, `x-remote-batch`, and `x-client-property` extensions into the OpenAPI document.

## Attributes

### `[RemoteQuery]`

Marks an endpoint as a read operation. The codegen generates a `query()` wrapper with caching.

```csharp
[RemoteQuery]
[HttpGet("favorites")]
public async Task<FoodDto[]> GetFavorites() { ... }
```

Set `Skip = true` to emit the endpoint in the spec without generating a remote function (the endpoint remains accessible via the raw ApiClient):

```csharp
[RemoteQuery(Skip = true)]
[HttpGet("raw-data")]
public async Task<byte[]> GetRawData() { ... }
```

### `[RemoteCommand]`

Marks an endpoint as a write operation. The codegen generates a `command()` wrapper.

Use `Invalidates` to specify which queries should be refreshed after the command succeeds. Short names resolve within the same tag; use the full `Tag_OperationId` form for cross-tag invalidation.

```csharp
[RemoteCommand(Invalidates = new[] { "GetFavorites" })]
[HttpPost("favorites")]
public async Task<FoodDto> AddFavorite([FromBody] CreateFoodRequest request) { ... }
```

### `[RemoteForm]`

Marks an endpoint as a form operation with progressive enhancement. The codegen generates a `form()` wrapper supporting field-level validation and graceful degradation without JavaScript.

```csharp
[RemoteForm(Invalidates = new[] { "GetProfile" })]
[HttpPost("profile")]
public async Task<ProfileDto> UpdateProfile([FromBody] UpdateProfileRequest request) { ... }
```

### `[RemoteBatch]`

Used alongside `[RemoteQuery]` to mark a query as batch-eligible. The codegen generates `query.batch()` instead of `query()`, collecting multiple concurrent calls into a single request for N+1 prevention.

```csharp
[RemoteQuery]
[RemoteBatch]
[HttpGet("items/{id}")]
public async Task<ItemDto> GetItem(string id) { ... }
```

### `[ClientPropertyName]`

Applied at the controller level to specify the property name used by the generated ApiClient. This tells codegen to emit `apiClient.{propertyName}.method()` calls.

```csharp
[ClientPropertyName("foodsV4")]
[ApiController]
[Route("api/v4/foods")]
public class FoodsController : ControllerBase { ... }
```

## Non-.NET Backends

If your backend is not .NET, you can add the `x-remote-*` extensions to your OpenAPI spec manually or with a custom processor for your framework. See the [Extension Specification](../../docs/extension-spec.md) for the full format reference.

## License

MIT
