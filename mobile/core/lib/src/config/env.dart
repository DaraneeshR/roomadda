import 'package:flutter_dotenv/flutter_dotenv.dart';

/// App configuration. Resolved from `--dart-define` first (works for flavors and
/// keeps secrets out of the repo), then an optional `.env` (flutter_dotenv),
/// then per-environment defaults. No secrets are committed.
class Env {
  Env._();

  static const String _appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'dev');
  static const String _apiFromDefine = String.fromEnvironment('API_BASE_URL');
  static const String _placesKeyFromDefine = String.fromEnvironment('GOOGLE_PLACES_API_KEY');
  static const String _payBaseFromDefine = String.fromEnvironment('PAY_BASE_URL');

  static bool get isProd => _appEnv == 'prod';

  /// Base of the user-facing pay page. The agent walk-in encodes
  /// `$payBaseUrl/pay/<bookingId>?order=<orderId>` into the QR the USER scans on
  /// their OWN device — the agent never pays. Must mirror the backend's
  /// `buildPayUrl` (PUBLIC_PAY_BASE_URL) so a scanned link resolves. Resolved from
  /// --dart-define first, then .env, then the backend's dev/local default.
  static String get payBaseUrl {
    if (_payBaseFromDefine.isNotEmpty) return _payBaseFromDefine;
    if (dotenv.isInitialized) {
      final v = dotenv.maybeGet('PAY_BASE_URL');
      if (v != null && v.isNotEmpty) return v;
    }
    return isProd ? 'https://app.roomadda.example' : 'https://app.roomadda.local';
  }

  /// Google Places API key for search autocomplete. Optional: when empty, the
  /// search field falls back to free-text city/area search (no suggestions).
  /// Resolved from --dart-define first, then .env. Never committed.
  static String get googlePlacesApiKey {
    if (_placesKeyFromDefine.isNotEmpty) return _placesKeyFromDefine;
    if (dotenv.isInitialized) {
      final v = dotenv.maybeGet('GOOGLE_PLACES_API_KEY');
      if (v != null) return v;
    }
    return '';
  }

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
