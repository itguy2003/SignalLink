import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:signallink_player/player_settings.dart';
import 'package:signallink_player/settings_screen.dart';

/// 설정 화면 — 검증 실패는 오류 문구로 남고, 통과하면 저장 후 표출로 넘어간다.
void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<void> pumpSettings(
    WidgetTester tester,
    PlayerSettings settings,
    VoidCallback onSaved,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: SettingsScreen(settings: settings, onSaved: onSaved)),
    );
  }

  testWidgets('잘못된 서버 주소는 오류 문구를 보여 주고 저장하지 않는다',
      (tester) async {
    var saved = false;
    await pumpSettings(tester, PlayerSettings(), () => saved = true);

    await tester.enterText(find.byType(TextField).at(0), 'not-a-url');
    await tester.tap(find.text('저장하고 표출 시작'));
    await tester.pump();

    expect(find.text('서버 주소를 http(s)://주소 형태로 입력하세요.'),
        findsOneWidget);
    expect(saved, isFalse);
  });

  testWidgets('장치 고유번호를 넣고 마스터 키를 비우면 거절한다', (tester) async {
    var saved = false;
    final settings = PlayerSettings(masterKey: '');
    await pumpSettings(tester, settings, () => saved = true);

    await tester.enterText(
        find.byType(TextField).at(0), 'http://localhost:8016');
    await tester.enterText(find.byType(TextField).at(1), 'AB12-CD3-EF4');
    await tester.tap(find.text('저장하고 표출 시작'));
    await tester.pump();

    expect(find.text('마스터 키를 입력하세요 (서버의 DEVICE_MASTER_KEY).'),
        findsOneWidget);
    expect(saved, isFalse);
  });

  testWidgets('올바른 입력은 저장하고 onSaved 를 부른다 — 다시 읽어도 그 값',
      (tester) async {
    var saved = false;
    await pumpSettings(tester, PlayerSettings(), () => saved = true);

    await tester.enterText(
        find.byType(TextField).at(0), 'http://localhost:8016/');
    await tester.enterText(find.byType(TextField).at(1), 'ab12-cd3-ef4');
    await tester.tap(find.text('저장하고 표출 시작'));
    await tester.pumpAndSettle();

    expect(saved, isTrue);

    final reloaded = await PlayerSettings.load();
    expect(reloaded.serverUrl, 'http://localhost:8016'); // 끝의 / 는 뗀다
    expect(reloaded.deviceCode, 'AB12-CD3-EF4'); // 대문자 정규화
    expect(reloaded.playerUrl, 'http://localhost:8016/player');
  });
}
