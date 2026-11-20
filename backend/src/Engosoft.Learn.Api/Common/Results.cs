using HttpResults = Microsoft.AspNetCore.Http.Results;

namespace Engosoft.Learn.Api.Common;

public enum ErrorKind { Validation, NotFound, Forbidden, Conflict, Blocked, Unauthorized, Upstream }

/// <summary>An expected failure. Messages are shown to the learner, so they are written in Arabic and never leak other people's data.</summary>
public sealed record Error(ErrorKind Kind, string Code, string Message)
{
    public static Error Validation(string code, string message) => new(ErrorKind.Validation, code, message);
    public static Error NotFound(string code = "not_found", string message = "هذا العنصر غير موجود.") => new(ErrorKind.NotFound, code, message);
    public static Error Forbidden(string code = "forbidden", string message = "غير مسموح لك بعرض هذا المحتوى.") => new(ErrorKind.Forbidden, code, message);
    public static Error Blocked(string code, string message) => new(ErrorKind.Blocked, code, message);
    public static Error Conflict(string code, string message) => new(ErrorKind.Conflict, code, message);
    public static Error Unauthorized(string code, string message) => new(ErrorKind.Unauthorized, code, message);
    public static Error Upstream(string message = "منصة إنجوسوفت لا تستجيب حاليًا. أعد المحاولة بعد قليل.") => new(ErrorKind.Upstream, "upstream_unavailable", message);
}

public readonly struct Result<T>
{
    private Result(T? value, Error? error) { Value = value; Error = error; }
    public T? Value { get; }
    public Error? Error { get; }
    public bool IsSuccess => Error is null;

    public static Result<T> Ok(T value) => new(value, null);
    public static Result<T> Fail(Error error) => new(default, error);

    public static implicit operator Result<T>(T value) => Ok(value);
    public static implicit operator Result<T>(Error error) => Fail(error);
}

public static class ResultHttpExtensions
{
    public static IResult ToHttp<T>(this Result<T> result, Func<T, IResult>? onSuccess = null) =>
        result.IsSuccess
            ? (onSuccess is null ? HttpResults.Ok(result.Value) : onSuccess(result.Value!))
            : result.Error!.ToProblem();

    public static IResult ToProblem(this Error error)
    {
        var status = error.Kind switch
        {
            ErrorKind.Validation => StatusCodes.Status400BadRequest,
            ErrorKind.Unauthorized => StatusCodes.Status401Unauthorized,
            ErrorKind.Forbidden => StatusCodes.Status403Forbidden,
            ErrorKind.NotFound => StatusCodes.Status404NotFound,
            ErrorKind.Conflict => StatusCodes.Status409Conflict,
            ErrorKind.Blocked => StatusCodes.Status422UnprocessableEntity,
            ErrorKind.Upstream => StatusCodes.Status503ServiceUnavailable,
            _ => StatusCodes.Status500InternalServerError
        };
        return HttpResults.Problem(detail: error.Message, statusCode: status, title: error.Code,
            extensions: new Dictionary<string, object?> { ["code"] = error.Code });
    }
}
