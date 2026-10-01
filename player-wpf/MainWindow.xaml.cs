using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace SignalLink.Player;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel = new();
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly DispatcherTimer _retryTimer = new() { Interval = TimeSpan.FromSeconds(5) };

    private string? _deviceToken;
    private string _currentUrl = "";
    private bool _allowClose;
    private bool _fullscreen = true;
    private string? _bootstrapScriptId;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = _viewModel;
        // 지난번에 FHD 창(테스트)이었으면 그대로 다시 뜬다.
        ApplyWindowMode(_viewModel.WindowMode != PlayerSettings.ModeFhd, save: false);
        _viewModel.NavigateRequested += url => _ = NavigateAsync(url);
        // 서버가 늦게 뜨는 부팅 직후 — 접속될 때까지 같은 주소를 다시 두드린다.
        _retryTimer.Tick += (_, _) =>
        {
            _retryTimer.Stop();
            if (!string.IsNullOrEmpty(_currentUrl)) _ = NavigateAsync(_currentUrl);
        };

        Loaded += async (_, _) =>
        {
            await InitializeWebViewAsync();
            _viewModel.Start();
        };

        // 키오스크(전체화면일 때만): 다른 창이 앞으로 오면 도로 올라온다.
        Deactivated += (_, _) => Dispatcher.BeginInvoke(() =>
        {
            if (_allowClose || !_fullscreen) return;
            Topmost = true;
            Activate();
        });

        // 전체화면에서는 관리자 단축키로만 종료 — Alt+F4 등은 무시한다.
        // FHD 창(테스트)에서는 보통 창처럼 닫힌다.
        Closing += (_, e) => e.Cancel = !_allowClose && _fullscreen;
        PreviewKeyDown += OnPreviewKeyDown;
    }

    // ---------------------------------------------------------------- 키오스크

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        var ctrlShift = Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift);
        if (ctrlShift && e.Key == Key.Q)
        {
            _allowClose = true;
            Close();
        }
        else if (ctrlShift && e.Key == Key.S)
        {
            _viewModel.SettingsOpen = true;
            e.Handled = true;
        }
        else if (ctrlShift && e.Key == Key.F)
        {
            ApplyWindowMode(!_fullscreen, save: true);
            e.Handled = true;
        }
    }

    /// <summary>전체화면(키오스크) ↔ FHD 창(테스트) 전환.
    ///
    /// 전체화면: 틀 없는 최대화 + 최상위 + 커서 숨김 + 닫기 봉인.
    /// FHD 창: 1920x1080 일반 창 — 최상위를 끄고 커서·작업표시줄·닫기를
    /// 되살려 다른 창과 나란히 놓고 시험할 수 있게 한다.</summary>
    private void ApplyWindowMode(bool fullscreen, bool save)
    {
        _fullscreen = fullscreen;
        if (fullscreen)
        {
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;
            Cursor = Cursors.None;
            Topmost = true;
            // 스타일을 바꾼 뒤에는 Normal 을 거쳐야 새 틀 기준으로 다시 채운다.
            WindowState = WindowState.Normal;
            WindowState = WindowState.Maximized;
            Activate();
        }
        else
        {
            Topmost = false;
            WindowState = WindowState.Normal;
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanMinimize;
            ShowInTaskbar = true;
            Cursor = Cursors.Arrow;
            Width = 1920;
            Height = 1080;
        }
        if (save)
        {
            _viewModel.SaveWindowMode(
                fullscreen ? PlayerSettings.ModeFullscreen : PlayerSettings.ModeFhd);
        }
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        // 사이니지는 화면이 꺼지면 존재 이유가 없다.
        SetThreadExecutionState(EsContinuous | EsDisplayRequired | EsSystemRequired);
    }

    protected override void OnClosed(EventArgs e)
    {
        SetThreadExecutionState(EsContinuous);
        base.OnClosed(e);
    }

    private const uint EsContinuous = 0x80000000;
    private const uint EsSystemRequired = 0x00000001;
    private const uint EsDisplayRequired = 0x00000002;

    [DllImport("kernel32.dll")]
    private static extern uint SetThreadExecutionState(uint esFlags);

    // ---------------------------------------------------------------- WebView2

    private async Task InitializeWebViewAsync()
    {
        var dataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "SignalLinkPlayer", "WebView2");
        // 사이니지 장치는 사용자 조작 없이도 동영상 소리가 나와야 한다 —
        // 브라우저의 '소리 있는 자동재생' 차단을 셸에서 풀어 둔다.
        var options = new CoreWebView2EnvironmentOptions(
            additionalBrowserArguments: "--autoplay-policy=no-user-gesture-required");
        var environment = await CoreWebView2Environment.CreateAsync(
            userDataFolder: dataFolder, options: options);
        await Web.EnsureCoreWebView2Async(environment);

        var settings = Web.CoreWebView2.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;

        Web.CoreWebView2.WebMessageReceived += OnWebMessage;
        Web.CoreWebView2.NavigationCompleted += (_, args) =>
        {
            // 서버가 아직 안 떠 있으면 잠시 후 다시 — 검은 화면으로 멈추지 않는다.
            if (!args.IsSuccess) _retryTimer.Start();
        };
        Web.CoreWebView2.ProcessFailed += (_, _) => _retryTimer.Start();
    }

    private async Task NavigateAsync(string url)
    {
        _currentUrl = url;
        if (Web.CoreWebView2 is null) await InitializeWebViewAsync();
        await UpdateBootstrapScriptAsync();
        Web.CoreWebView2!.Navigate(url);
    }

    /// <summary>셸 설정의 장치 고유번호·마스터 키를 웹 플레이어의 저장소에 주입한다.
    ///
    /// 웹 플레이어는 localStorage 의 'signallink.player' 를 읽어 자동 기동한다
    /// (frontend PlayerView.vue). 페이지 스크립트가 돌기 전에 심어야 하므로
    /// 문서 생성 시점 스크립트로 넣고, 설정이 바뀌면 갈아 끼운다.</summary>
    private async Task UpdateBootstrapScriptAsync()
    {
        if (Web.CoreWebView2 is null) return;
        if (_bootstrapScriptId is not null)
        {
            Web.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_bootstrapScriptId);
            _bootstrapScriptId = null;
        }

        var settings = PlayerSettings.Load();
        if (string.IsNullOrWhiteSpace(settings.DeviceCode)) return;

        var payload = JsonSerializer.Serialize(new
        {
            device_code = settings.DeviceCode,
            master_key = settings.MasterKey,
        });
        var script = "try { localStorage.setItem('signallink.player', "
            + JsonSerializer.Serialize(payload) + "); } catch {}";
        _bootstrapScriptId = await Web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(script);
    }

    // ------------------------------------------------- 웹 플레이어 → 셸 다리

    /// <summary>웹 플레이어가 window.chrome.webview.postMessage 로 보낸다.
    /// provisioned: 장치 토큰(캡처 업로드에 쓴다) / screenshot: 화면 캡처 요청.</summary>
    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

            if (type == "provisioned")
            {
                _deviceToken = root.TryGetProperty("device_token", out var token)
                    ? token.GetString() : null;
            }
            else if (type == "screenshot")
            {
                await UploadScreenshotAsync();
            }
        }
        catch
        {
            // 다리 메시지가 깨져도 표출은 계속돼야 한다.
        }
    }

    /// <summary>지금 화면을 캡처해 서버에 올린다 — 브라우저 플레이어는 못 하는 일.</summary>
    private async Task UploadScreenshotAsync()
    {
        if (_deviceToken is null || string.IsNullOrEmpty(_viewModel.ServerUrl)) return;

        using var stream = new MemoryStream();
        await Web.CoreWebView2.CapturePreviewAsync(
            CoreWebView2CapturePreviewImageFormat.Png, stream);
        stream.Position = 0;

        using var form = new MultipartFormDataContent();
        var image = new StreamContent(stream);
        image.Headers.ContentType = new("image/png");
        form.Add(image, "file", "screenshot.png");

        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"{_viewModel.ServerUrl}/api/v1/player/screenshot")
        {
            Content = form,
        };
        request.Headers.Add("X-Device-Token", _deviceToken);
        try
        {
            await _http.SendAsync(request);
        }
        catch
        {
            // 캡처는 부가 기능이다 — 실패해도 표출은 계속.
        }
    }
}
