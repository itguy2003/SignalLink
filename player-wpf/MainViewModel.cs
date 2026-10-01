using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace SignalLink.Player;

/// <summary>셸의 상태 — 서버 주소와 설정 화면 표시 여부.
///
/// 표출 상태(접속·스케줄)는 웹 플레이어가 제 화면에 그린다. 여기서 겹쳐
/// 관리하면 두 화면이 서로 다른 이야기를 한다.</summary>
public partial class MainViewModel : ObservableObject
{
    private readonly PlayerSettings _settings = PlayerSettings.Load();

    [ObservableProperty]
    private string _serverUrl = "";

    [ObservableProperty]
    private string _deviceCode = "";

    [ObservableProperty]
    private string _masterKey = "";

    [ObservableProperty]
    private bool _settingsOpen;

    [ObservableProperty]
    private string _settingsError = "";

    /// <summary>저장된 주소로 이동해 달라는 신호. 창(코드비하인드)이 받아 탐색한다.</summary>
    public event Action<string>? NavigateRequested;

    public MainViewModel()
    {
        ServerUrl = _settings.ServerUrl;
        DeviceCode = _settings.DeviceCode;
        MasterKey = _settings.MasterKey;
        // 주소가 없으면 설정부터 — 어디로 가야 할지 모른다.
        SettingsOpen = string.IsNullOrWhiteSpace(ServerUrl);
    }

    /// <summary>기동 시 저장된 주소가 있으면 바로 표출로 간다.</summary>
    public void Start()
    {
        if (!SettingsOpen) NavigateRequested?.Invoke(PlayerUrl(ServerUrl));
    }

    [RelayCommand]
    private void SaveSettings()
    {
        var url = ServerUrl.Trim().TrimEnd('/');
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed)
            || (parsed.Scheme != "http" && parsed.Scheme != "https"))
        {
            SettingsError = "서버 주소를 http(s)://주소 형태로 입력하세요.";
            return;
        }

        // 장치 고유번호는 선택이다 — 비우면 웹 플레이어 화면이 받는다.
        var code = DeviceCode.Trim().ToUpperInvariant();
        if (code.Length > 0
            && !System.Text.RegularExpressions.Regex.IsMatch(code, "^[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{3}$"))
        {
            SettingsError = "장치 고유번호는 XXXX-XXX-XXX 형식입니다.";
            return;
        }
        if (code.Length > 0 && string.IsNullOrWhiteSpace(MasterKey))
        {
            SettingsError = "마스터 키를 입력하세요 (서버의 DEVICE_MASTER_KEY).";
            return;
        }

        ServerUrl = url;
        DeviceCode = code;
        _settings.ServerUrl = url;
        _settings.DeviceCode = code;
        _settings.MasterKey = MasterKey;
        _settings.Save();
        SettingsError = "";
        SettingsOpen = false;
        NavigateRequested?.Invoke(PlayerUrl(url));
    }

    [RelayCommand]
    private void OpenSettings() => SettingsOpen = true;

    /// <summary>저장된 창 모드 — 창이 기동 시 읽는다.</summary>
    public string WindowMode => _settings.WindowMode;

    /// <summary>창 모드 토글을 설정 파일에 남긴다. 설정 저장(SaveSettings)과
    /// 같은 인스턴스를 거쳐야 서로의 값을 덮어쓰지 않는다.</summary>
    public void SaveWindowMode(string mode)
    {
        _settings.WindowMode = mode;
        _settings.Save();
    }

    public static string PlayerUrl(string serverUrl) => $"{serverUrl.TrimEnd('/')}/player";
}
