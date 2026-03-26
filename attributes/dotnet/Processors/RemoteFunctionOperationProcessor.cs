using System.Reflection;
using OpenApi.Remote.Attributes;
using NSwag.Generation.Processors;
using NSwag.Generation.Processors.Contexts;

namespace OpenApi.Remote.Processors;

/// <summary>
/// NSwag operation processor that emits x-remote-type, x-remote-invalidates,
/// and x-client-property extensions based on Remote* and ClientPropertyName attributes.
/// </summary>
public class RemoteFunctionOperationProcessor : IOperationProcessor
{
    public bool Process(OperationProcessorContext context)
    {
        var methodInfo = context.MethodInfo;

        var queryAttr = methodInfo.GetCustomAttribute<RemoteQueryAttribute>();
        var commandAttr = methodInfo.GetCustomAttribute<RemoteCommandAttribute>();
        var formAttr = methodInfo.GetCustomAttribute<RemoteFormAttribute>();

        if (queryAttr != null && !queryAttr.Skip)
        {
            context.OperationDescription.Operation.ExtensionData ??= new Dictionary<string, object?>();
            context.OperationDescription.Operation.ExtensionData["x-remote-type"] = "query";

            var batchAttr = methodInfo.GetCustomAttribute<RemoteBatchAttribute>();
            if (batchAttr != null)
            {
                context.OperationDescription.Operation.ExtensionData["x-remote-batch"] = true;
            }
        }
        else if (commandAttr != null && !commandAttr.Skip)
        {
            context.OperationDescription.Operation.ExtensionData ??= new Dictionary<string, object?>();
            context.OperationDescription.Operation.ExtensionData["x-remote-type"] = "command";

            if (commandAttr.Invalidates.Length > 0)
            {
                context.OperationDescription.Operation.ExtensionData["x-remote-invalidates"] = commandAttr.Invalidates;
            }
        }
        else if (formAttr != null && !formAttr.Skip)
        {
            context.OperationDescription.Operation.ExtensionData ??= new Dictionary<string, object?>();
            context.OperationDescription.Operation.ExtensionData["x-remote-type"] = "form";

            if (formAttr.Invalidates.Length > 0)
            {
                context.OperationDescription.Operation.ExtensionData["x-remote-invalidates"] = formAttr.Invalidates;
            }
        }

        var clientPropertyAttr = methodInfo.DeclaringType?.GetCustomAttribute<ClientPropertyNameAttribute>();
        if (clientPropertyAttr != null)
        {
            context.OperationDescription.Operation.ExtensionData ??= new Dictionary<string, object?>();
            context.OperationDescription.Operation.ExtensionData["x-client-property"] = clientPropertyAttr.PropertyName;
        }

        return true;
    }
}
