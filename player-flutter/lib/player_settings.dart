import 'package:shared_preferences/shared_preferences.dart';

/// 셸이 기억하는 값 — 서버 주소, 장치 고유번호, 마스터 키.
///
/// 장치 값의 정본 저장소는 웹 플레이어의 localStorage 다. 셸 설정에서
/// 입력하면 페이지가 뜨기 전에 그 저장소에 **주입**해(문서 시작 스크립트)
/// 웹 플레이어가 곧장 그 장치로 표출한다 — 값이 두 곳에서 자라지 않도록
/// 주입은 한 방향(셸 → 웹)뿐이다. WPF 셸의 PlayerSettings 와 같은 계약.
class PlayerSettings {
  PlayerSettings({
    this.serverUrl = '',
    this.deviceCode = '',
    this.masterKey = defaultMasterKey,
  });

  /// 서버의 DEVICE_MASTER_KEY 기본값(개발용) — WPF 셸과 동일.
  static const defaultMasterKey = 'dev-device-master-key-change-me';

  static final deviceCodePattern =
      RegExp(r'^[A-Z0-9]{4}-[A-Z0-9]{3}-[A-Z0-9]{3}$');

  String serverUrl;

  /// 장치 고유번호(XXXX-XXX-XXX). 비우면 웹 플레이어 화면에서 받는다.
  String deviceCode;

  /// 장치 채널 마스터 키 — 서버 DEVICE_MASTER_KEY 와 같아야 한다.
  String masterKey;

  bool get configured => serverUrl.isNotEmpty;

  /// 표출 페이지 주소 — WPF 셸의 PlayerUrl 과 동일한 규칙.
  String get playerUrl =>
      '${serverUrl.replaceAll(RegExp(r'/+$'), '')}/player';

  static Future<PlayerSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    return PlayerSettings(
      serverUrl: prefs.getString('serverUrl') ?? '',
      deviceCode: prefs.getString('deviceCode') ?? '',
      masterKey: prefs.getString('masterKey') ?? defaultMasterKey,
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('serverUrl', serverUrl);
    await prefs.setString('deviceCode', deviceCode);
    await prefs.setString('masterKey', masterKey);
  }

  /// 입력값 검증 — 통과하면 정규화된 값을 이 인스턴스에 반영하고 null,
  /// 아니면 오류 문구를 돌려준다. 문구는 WPF 셸과 같다.
  String? applyInput({
    required String serverUrl,
    required String deviceCode,
    required String masterKey,
  }) {
    final url = serverUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final parsed = Uri.tryParse(url);
    if (parsed == null ||
        !parsed.isAbsolute ||
        (parsed.scheme != 'http' && parsed.scheme != 'https')) {
      return '서버 주소를 http(s)://주소 형태로 입력하세요.';
    }

    // 장치 고유번호는 선택이다 — 비우면 웹 플레이어 화면이 받는다.
    final code = deviceCode.trim().toUpperCase();
    if (code.isNotEmpty && !deviceCodePattern.hasMatch(code)) {
      return '장치 고유번호는 XXXX-XXX-XXX 형식입니다.';
    }
    if (code.isNotEmpty && masterKey.trim().isEmpty) {
      return '마스터 키를 입력하세요 (서버의 DEVICE_MASTER_KEY).';
    }

    this.serverUrl = url;
    this.deviceCode = code;
    this.masterKey = masterKey;
    return null;
  }
}
