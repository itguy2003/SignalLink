// 공통 응답 계약 — FastAPI(app/schemas/common.py)의 짝.

namespace SignalLink.Api.Contracts;

public record PageOut<T>(List<T> Items, int Total, int Page, int Size);

public record Message(string Detail);

public class BulkResult
{
    public int Created { get; set; }
    public int Updated { get; set; }
    public int Skipped { get; set; }
    public List<string> Errors { get; set; } = [];
}
