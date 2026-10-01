using System.IO;
using System.Text.Json;

namespace SignalLink.Player;

/// <summary>셸이 기억하는 값 — 서버 주소, 장치 고유번호, 마스터 키.
///
/// 장치 값의 정본 저장소는 웹 플레이어의 localStorage 다. 셸 설정에서
/// 입력하면 페이지가 뜨기 전에 그 저장소에 **주입**해(부트스트랩 스크립트)
/// 웹 플레이어가 곧장 그 장치로 표출한다 — 값이 두 곳에서 자라지 않도록
/// 주입은 한 방향(셸 → 웹)뿐이다.</summary>
public sealed class PlayerSettings
{
    public string ServerUrl { get; set; } = "";

    /// <summary>장치 고유번호(XXXX-XXX-XXX). 비우면 웹 플레이어 화면에서 받는다.</summary>
    public string DeviceCode { get; set; } = "";

    /// <summary>장치 채널 마스터 키 — 서버 DEVICE_MASTER_KEY 와 같아야 한다.</summary>
    public string MasterKey { get; set; } = "dev-device-master-key-change-me";

    public const string ModeFullscreen = "fullscreen";
    public const string ModeFhd = "fhd";

    /// <summary>창 모드. fullscreen = 키오스크(전체화면·최상위·닫기 봉인),
    /// fhd = 테스트용 1920x1080 일반 창(최상위 없음). Ctrl+Shift+F 로 오간다.</summary>
    public string WindowMode { get; set; } = ModeFullscreen;

    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "SignalLinkPlayer", "settings.json");

    public static PlayerSettings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<PlayerSettings>(File.ReadAllText(FilePath))
                    ?? new PlayerSettings();
        }
        catch
        {
            // 깨진 설정은 새로 받는다.
        }
        return new PlayerSettings();
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this));
    }
}
