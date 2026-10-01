import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'player_settings.dart';

/// 셸 설정 화면 — 서버 주소·장치 고유번호·마스터 키.
///
/// WPF 셸의 Ctrl+Shift+S 설정 패널과 같은 역할. 터치 장치라 단축키 대신
/// 화면 왼쪽 위 모서리를 다섯 번 두드려 연다(플레이어 화면 쪽에서 처리).
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.settings,
    required this.onSaved,
    this.canClose = false,
    this.onClose,
  });

  final PlayerSettings settings;

  /// 검증을 통과해 저장까지 끝났을 때 불린다 — 플레이어가 새 주소로 뜬다.
  final VoidCallback onSaved;

  /// 이미 표출 중이면 저장 없이 되돌아갈 수 있다. 최초 설정에는 없다.
  final bool canClose;
  final VoidCallback? onClose;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _serverUrl =
      TextEditingController(text: widget.settings.serverUrl);
  late final TextEditingController _deviceCode =
      TextEditingController(text: widget.settings.deviceCode);
  late final TextEditingController _masterKey =
      TextEditingController(text: widget.settings.masterKey);
  String _error = '';

  @override
  void dispose() {
    _serverUrl.dispose();
    _deviceCode.dispose();
    _masterKey.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final error = widget.settings.applyInput(
      serverUrl: _serverUrl.text,
      deviceCode: _deviceCode.text,
      masterKey: _masterKey.text,
    );
    if (error != null) {
      setState(() => _error = error);
      return;
    }
    await widget.settings.save();
    widget.onSaved();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'SignalLink 플레이어 설정',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _serverUrl,
                  keyboardType: TextInputType.url,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: '서버 주소',
                    hintText: 'http://192.168.0.10:8016',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _deviceCode,
                  autocorrect: false,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(
                    labelText: '장치 고유번호 (선택, XXXX-XXX-XXX)',
                    hintText: '비우면 표출 화면에서 입력합니다',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _masterKey,
                  autocorrect: false,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: '마스터 키 (서버의 DEVICE_MASTER_KEY)',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_error.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    _error,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _save,
                  child: const Text('저장하고 표출 시작'),
                ),
                if (widget.canClose) ...[
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: widget.onClose,
                    child: const Text('돌아가기'),
                  ),
                ],
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => SystemNavigator.pop(),
                  child: const Text('앱 종료'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
