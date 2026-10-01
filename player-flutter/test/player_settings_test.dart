import 'package:flutter_test/flutter_test.dart';
import 'package:signallink_player/player_settings.dart';

/// 셸 설정 검증 — WPF 셸(PlayerSettings/MainViewModel)과 같은 규칙,
/// 같은 오류 문구를 지켜야 두 셸의 안내가 어긋나지 않는다.
void main() {
  group('applyInput', () {
    test('http(s) 가 아닌 주소는 거절한다', () {
      final settings = PlayerSettings();
      expect(
        settings.applyInput(
            serverUrl: 'ftp://x', deviceCode: '', masterKey: 'k'),
        '서버 주소를 http(s)://주소 형태로 입력하세요.',
      );
      expect(
        settings.applyInput(serverUrl: '', deviceCode: '', masterKey: 'k'),
        '서버 주소를 http(s)://주소 형태로 입력하세요.',
      );
    });

    test('장치 고유번호는 XXXX-XXX-XXX 형식만 받고 대문자로 정규화한다', () {
      final settings = PlayerSettings();
      expect(
        settings.applyInput(
          serverUrl: 'http://localhost:8016',
          deviceCode: 'bad-code',
          masterKey: 'k',
        ),
        '장치 고유번호는 XXXX-XXX-XXX 형식입니다.',
      );

      expect(
        settings.applyInput(
          serverUrl: 'http://localhost:8016',
          deviceCode: 'ab12-cd3-ef4',
          masterKey: 'k',
        ),
        isNull,
      );
      expect(settings.deviceCode, 'AB12-CD3-EF4');
    });

    test('장치 고유번호를 넣으면 마스터 키가 필수다', () {
      final settings = PlayerSettings();
      expect(
        settings.applyInput(
          serverUrl: 'http://localhost:8016',
          deviceCode: 'AB12-CD3-EF4',
          masterKey: '  ',
        ),
        '마스터 키를 입력하세요 (서버의 DEVICE_MASTER_KEY).',
      );
    });

    test('장치 고유번호는 선택 — 비우면 마스터 키 없이도 통과한다', () {
      final settings = PlayerSettings();
      expect(
        settings.applyInput(
          serverUrl: 'http://localhost:8016/',
          deviceCode: '',
          masterKey: '',
        ),
        isNull,
      );
      // 끝의 / 는 떼고 저장한다.
      expect(settings.serverUrl, 'http://localhost:8016');
    });
  });

  test('표출 주소는 <서버>/player — WPF 셸의 PlayerUrl 과 같은 규칙', () {
    final settings = PlayerSettings(serverUrl: 'http://localhost:8016');
    expect(settings.playerUrl, 'http://localhost:8016/player');
  });
}
