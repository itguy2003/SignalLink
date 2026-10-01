import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import 'player_settings.dart';
import 'settings_screen.dart';

/// 표출 화면 — 웹 플레이어(<서버>/player)를 WebView 로 품는다.
///
/// 셸이 보태는 것(WPF 셸과 동일한 계약):
///   * 소리 있는 자동재생 허용 — WPF 의 --autoplay-policy 플래그에 해당하는
///     mediaPlaybackRequiresUserGesture=false.
///   * 문서 시작 스크립트로 장치 고유번호·마스터 키를 localStorage
///     ('signallink.player')에 주입 — 페이지 스크립트보다 먼저 실행됨을
///     엔진이 보장한다.
///   * window.chrome.webview.postMessage 다리 — 웹 플레이어는 WPF(WebView2)
///     기준으로 이 통로에만 말한다. 같은 이름의 통로를 심어(shim) 웹 쪽
///     수정 없이 provisioned/screenshot 메시지를 받는다.
///   * 화면 캡처 업로드(/api/v1/player/screenshot) — 브라우저는 못 하는 일.
///   * 접속 실패 시 5초 간격 재시도 — 부팅 직후 서버가 늦게 떠도 검은
///     화면으로 멈추지 않는다.
///   * 설정 열기: 왼쪽 위 모서리를 3초 안에 다섯 번 탭(터치 장치라 단축키
///     대신). 뒤로가기는 봉인한다 — 종료는 설정 화면의 '앱 종료'로.
class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key});

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  PlayerSettings? _settings;
  bool _settingsOpen = false;

  /// 설정이 바뀌면 새 부트스트랩 스크립트로 WebView 를 다시 만든다.
  int _webGeneration = 0;

  InAppWebViewController? _controller;
  String? _deviceToken;
  Timer? _retryTimer;

  // 설정 열기 제스처 — 왼쪽 위 모서리 다섯 번 탭.
  final List<DateTime> _cornerTaps = [];

  @override
  void initState() {
    super.initState();
    PlayerSettings.load().then((settings) {
      if (!mounted) return;
      setState(() {
        _settings = settings;
        // 주소가 없으면 설정부터 — 어디로 가야 할지 모른다.
        _settingsOpen = !settings.configured;
      });
    });
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    super.dispose();
  }

  // ------------------------------------------------------------ 부트스트랩

  /// 페이지 스크립트가 돌기 전에 심는 것들. 문서 시작 시점에 실행된다.
  UnmodifiableListView<UserScript> _userScripts(PlayerSettings settings) {
    final scripts = <UserScript>[];

    // 장치 값 주입 — 웹 플레이어는 localStorage 'signallink.player' 를 읽어
    // 자동 기동한다(frontend PlayerView.vue). WPF 셸과 같은 한 방향 주입.
    if (settings.deviceCode.isNotEmpty) {
      final payload = jsonEncode({
        'device_code': settings.deviceCode,
        'master_key': settings.masterKey,
      });
      scripts.add(UserScript(
        source: 'try { localStorage.setItem(${jsonEncode('signallink.player')},'
            ' ${jsonEncode(payload)}); } catch (e) {}',
        injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
        forMainFrameOnly: true,
      ));
    }

    // 셸 다리 shim — 웹 플레이어는 window.chrome.webview.postMessage 로만
    // 말한다(WebView2 통로). 같은 이름을 심어 Flutter 핸들러로 넘긴다.
    // 핸들러는 엔진 준비 이벤트 뒤에야 부를 수 있으므로 그전 메시지는 줄을
    // 세운다.
    scripts.add(UserScript(
      source: '''
(function () {
  if (window.chrome && window.chrome.webview) return;
  var queue = [];
  var ready = false;
  window.addEventListener('flutterInAppWebViewPlatformReady', function () {
    ready = true;
    var pending = queue.splice(0);
    for (var i = 0; i < pending.length; i++) {
      window.flutter_inappwebview.callHandler('signallinkShell', pending[i]);
    }
  });
  function post(message) {
    if (ready && window.flutter_inappwebview) {
      window.flutter_inappwebview.callHandler('signallinkShell', message);
    } else {
      queue.push(message);
    }
  }
  window.chrome = window.chrome || {};
  window.chrome.webview = { postMessage: post };
})();
''',
      injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
      forMainFrameOnly: true,
    ));

    return UnmodifiableListView(scripts);
  }

  // ------------------------------------------------- 웹 플레이어 → 셸 다리

  /// provisioned: 장치 토큰(캡처 업로드에 쓴다) / screenshot: 화면 캡처 요청.
  void _onShellMessage(List<dynamic> args) {
    final message = args.isNotEmpty ? args.first : null;
    if (message is! Map) return;
    switch (message['type']) {
      case 'provisioned':
        _deviceToken = message['device_token'] as String?;
      case 'screenshot':
        unawaited(_uploadScreenshot());
    }
  }

  /// 지금 화면을 캡처해 서버에 올린다 — 브라우저 플레이어는 못 하는 일.
  Future<void> _uploadScreenshot() async {
    final settings = _settings;
    final controller = _controller;
    final token = _deviceToken;
    if (settings == null || controller == null || token == null) return;

    try {
      final png = await controller.takeScreenshot();
      if (png == null) return;

      final request = http.MultipartRequest(
        'POST',
        Uri.parse('${settings.serverUrl}/api/v1/player/screenshot'),
      )
        ..headers['X-Device-Token'] = token
        ..files.add(http.MultipartFile.fromBytes(
          'file',
          png,
          filename: 'screenshot.png',
          contentType: MediaType('image', 'png'),
        ));
      await request.send().timeout(const Duration(seconds: 30));
    } catch (_) {
      // 캡처는 부가 기능이다 — 실패해도 표출은 계속.
    }
  }

  // ------------------------------------------------------------ 재시도

  /// 서버가 늦게 뜨는 부팅 직후 — 접속될 때까지 같은 주소를 다시 두드린다.
  void _scheduleRetry() {
    _retryTimer?.cancel();
    _retryTimer = Timer(const Duration(seconds: 5), () {
      final settings = _settings;
      if (settings == null || !settings.configured) return;
      _controller?.loadUrl(
        urlRequest: URLRequest(url: WebUri(settings.playerUrl)),
      );
    });
  }

  // ------------------------------------------------------------ 설정 제스처

  void _onCornerTap() {
    final now = DateTime.now();
    _cornerTaps.add(now);
    _cornerTaps.removeWhere(
      (tap) => now.difference(tap) > const Duration(seconds: 3),
    );
    if (_cornerTaps.length >= 5) {
      _cornerTaps.clear();
      setState(() => _settingsOpen = true);
    }
  }

  void _onSettingsSaved() {
    setState(() {
      _settingsOpen = false;
      // 부트스트랩 스크립트는 WebView 생성 시점에 굳는다 — 새로 만든다.
      _webGeneration += 1;
      _deviceToken = null;
    });
  }

  // ------------------------------------------------------------ 화면

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    if (settings == null) {
      return const Scaffold(body: SizedBox.shrink());
    }

    if (_settingsOpen || !settings.configured) {
      return PopScope(
        canPop: false,
        child: SettingsScreen(
          settings: settings,
          onSaved: _onSettingsSaved,
          canClose: settings.configured,
          onClose: () => setState(() => _settingsOpen = false),
        ),
      );
    }

    return PopScope(
      // 키오스크 — 뒤로가기로는 끌 수 없다. 종료는 설정 화면에서.
      canPop: false,
      child: Scaffold(
        body: Stack(
          children: [
            InAppWebView(
              key: ValueKey('player-$_webGeneration'),
              initialUrlRequest: URLRequest(url: WebUri(settings.playerUrl)),
              initialUserScripts: _userScripts(settings),
              initialSettings: InAppWebViewSettings(
                // 사이니지 장치는 사용자 조작 없이도 동영상 소리가 나와야
                // 한다 — 브라우저의 '소리 있는 자동재생' 차단을 셸에서 푼다.
                mediaPlaybackRequiresUserGesture: false,
                allowsInlineMediaPlayback: true,
                supportZoom: false,
                disableContextMenu: true,
                transparentBackground: false,
              ),
              onWebViewCreated: (controller) {
                _controller = controller;
                controller.addJavaScriptHandler(
                  handlerName: 'signallinkShell',
                  callback: _onShellMessage,
                );
              },
              onReceivedError: (controller, request, error) {
                // 서버가 아직 안 떠 있으면 잠시 후 다시 — 검은 화면으로
                // 멈추지 않는다.
                if (request.isForMainFrame ?? true) _scheduleRetry();
              },
              onReceivedHttpError: (controller, request, response) {
                if (request.isForMainFrame ?? true) _scheduleRetry();
              },
            ),
            // 설정 열기 — 왼쪽 위 모서리를 3초 안에 다섯 번 탭.
            Positioned(
              left: 0,
              top: 0,
              width: 96,
              height: 96,
              child: GestureDetector(
                behavior: HitTestBehavior.translucent,
                onTap: _onCornerTap,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
