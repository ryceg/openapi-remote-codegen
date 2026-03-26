namespace OpenApi.Remote.Attributes;

/// <summary>
/// Marks a query endpoint as batch-eligible, generating query.batch() instead of query().
/// Batch queries collect multiple concurrent calls and execute them in a single request.
/// Must be used alongside [RemoteQuery].
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public class RemoteBatchAttribute : Attribute;
