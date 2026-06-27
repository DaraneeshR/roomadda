import 'package:flutter_dotenv/flutter_dotenv.dart';

/// App configuration. Resolved from `--dart-define` first (works for flavors and
/// keeps secrets out of the repo), then an optional `.env` (flutter_dotenv),
/// then per-environment defaults. No secrets are committed.
class Env {
  Env._();

  static const String _appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'dev');
  static const String _apiFromDefine = String.fromEnvironment('API_BASE_URL');

  static bool get isProd => _appEnv == 'prod';

  static String get apiBaseUrl {
    if (_apiFromDefine.isNotEmpty) return _apiFromDefine;
    if (dotenv.isInitialized) {
      final fromDot = dotenv.maybeGet('API_BASE_URL');
      if (fromDot != null && fromDot.isNotEmpty) return fromDot;
    }
    // Dev default: 10.0.2.2 is the Android emulator alias for the host machine.
    return isProd ? 'https://api.roomadda.example' : 'http://10.0.2.2:3001';
  }
}
