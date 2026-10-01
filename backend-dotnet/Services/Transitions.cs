// 위젯 전환 효과 규약 — FastAPI(app/services/transitions.py)의 짝.
//
// 서버가 규약의 주인이다. 이름은 '무엇이 어떻게 들어오는가'를 뜻하고,
// 플레이어는 모르는 값을 만나면 none 으로 떨어뜨린다.

namespace SignalLink.Api.Services;

public static class Transitions
{
    public static readonly string[] All =
    [
        "none", "fade", "dissolve", "blur",
        "slide-left", "slide-right", "slide-up", "slide-down",
        "wipe-left", "wipe-right",
        "zoom", "zoom-out", "flip", "rotate",
    ];

    public const string Default = "none";
    public const int DefaultMs = 600;
    public const int MinMs = 100;
    public const int MaxMs = 5000;

    /// <summary>모르는 이름은 none 으로 — 저장된 값이 뒤에 사라질 수도 있다.</summary>
    public static string Normalize(string? value) =>
        value is not null && All.Contains(value) ? value : Default;

    /// <summary>범위를 벗어난 시간은 끌어다 맞춘다 — 내려받는 값은 늘 쓸 수 있는 범위다.</summary>
    public static int NormalizeMs(int? value) =>
        value is null ? DefaultMs : Math.Clamp(value.Value, MinMs, MaxMs);

    /// <summary>전환이 표출 시간 안에 끝나는가 — 아니면 저장에서 막는다.</summary>
    public static bool FitsIn(string transition, int transitionMs, int durationSec)
    {
        if (Normalize(transition) == Default) return true;
        return NormalizeMs(transitionMs) <= durationSec * 1000;
    }
}
