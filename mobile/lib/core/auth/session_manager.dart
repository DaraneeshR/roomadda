import 'secure_token_store.dart';

/// In-memory access to the current tokens, backed by [SecureTokenStore]. Shared
/// by the auth controller (login/logout) and the dio auth interceptor (attach +
/// refresh), so they never disagree about the current session.
class SessionManager {
  final SecureTokenStore _store;
  String? _accessToken;
  String? _refreshToken;

  SessionManager(this._store);

  String? get accessToken => _accessToken;
  String? get refreshToken => _refreshToken;
  bool get hasSession => _refreshToken != null;

  Future<void> load() async {
    final tokens = await _store.read();
    _accessToken = tokens?.access;
    _refreshToken = tokens?.refresh;
  }

  Future<void> save(String access, String refresh) async {
    _accessToken = access;
    _refreshToken = refresh;
    await _store.save(access, refresh);
  }

  Future<void> clear() async {
    _accessToken = null;
    _refreshToken = null;
    await _store.clear();
  }
}
