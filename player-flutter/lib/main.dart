import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'player_screen.dart';

/// SignalLink 플레이어 (Android/iOS 키오스크 셸).
///
/// 표출 엔진은 브라우저 플레이어(frontend /player)를 그대로 쓴다 — 스케줄
/// 수신·암호화 채널(WS)·전환 효과·렌더링이 이미 거기 구현돼 있고, 렌더러를
/// 두 벌 유지하면 반드시 어긋난다(WPF 셸과 같은 설계). 이 앱은 그 페이지를
/// WebView 로 품는 셸이며, 브라우저가 못 하는 것만 보탠다: 소리 있는
/// 자동재생 허용, 설정 저장·부트스트랩 주입, 화면 캡처 업로드, 화면 꺼짐 방지.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 사이니지 기본 자세 — 가로 고정, 상태바·내비게이션바 숨김(몰입 전체화면).
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  // 화면이 꺼지면 사이니지는 존재 이유가 없다.
  await WakelockPlus.enable();
  runApp(const SignalLinkPlayerApp());
}

class SignalLinkPlayerApp extends StatelessWidget {
  const SignalLinkPlayerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SignalLink 플레이어',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: Colors.black,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF3B82F6),
          brightness: Brightness.dark,
        ),
      ),
      home: const PlayerScreen(),
    );
  }
}
