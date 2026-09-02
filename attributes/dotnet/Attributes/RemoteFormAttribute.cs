namespace OpenApi.Remote.Attributes;

/// <summary>
/// Marks an endpoint for remote function generation as a form (write operation with progressive enhancement).
/// Forms are tied to HTML form elements and support field-level validation, sensitive field protection,
/// and graceful degradation without JavaScript.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public class RemoteFormAttribute : Attribute
{
    /// <summary>
    /// Operation names of queries to invalidate after this form succeeds.
    /// Use short names for same-domain (e.g., "GetNotes") or full operationId
    /// for cross-domain (e.g., "Trackers_GetActiveInstances"); a cross-domain
    /// target is imported into the generated file.
    /// </summary>
    /// <remarks>
    /// See <see cref="RemoteCommandAttribute.Invalidates"/> for how per-argument
    /// query keys decide what a declaration here can reach on its own.
    /// </remarks>
    public string[] Invalidates { get; set; } = [];

    /// <summary>
    /// If true, skip generating a remote function for this endpoint.
    /// The endpoint remains accessible via the raw ApiClient.
    /// </summary>
    public bool Skip { get; set; } = false;
}
