import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../network/api_exception.dart';
import 'auth_repository.dart';
import 'auth_state.dart';
import 'models.dart';
import 'session_manager.dart';

class AuthController extends StateNotifier<AuthState> {
  final AuthRepository _repo;
  final SessionManager _session;

  AuthController(this._repo, this._session) : super(const AuthUnknown()) {
    _bootstrap();
  }

  /// On launch, restore the session from secure storage. The access token may be
  /// stale; the dio interceptor refreshes it transparently during /v1/me.
  Future<void> _bootstrap() async {
    await _session.load();
    if (!_session.hasSession) {
      state = const AuthUnauthenticated();
      return;
    }
    try {
      final user = await _repo.me();
      state = AuthAuthenticated(user);
    } catch (_) {
      await _session.clear();
      state = const AuthUnauthenticated();
    }
  }

  Future<void> requestOtp(String phone) => _repo.requestOtp(phone);

  Future<void> verifyOtp(String phone, String code) async {
    state = const AuthAuthenticating();
    try {
      final session = await _repo.verifyOtp(phone, code);
      await _session.save(session.accessToken, session.refreshToken);
      // Role comes from the canonical /v1/me (requirement).
      final user = await _repo.me();
      state = AuthAuthenticated(user);
    } catch (e) {
      await _session.clear();
      final api = apiExceptionFrom(e);
      if (api.code == 'WRONG_APP') {
        // The server turned this number away from this app — show the dedicated
        // screen instead of a login error (no session was issued).
        state = AuthWrongApp(_roleFromDetails(api.details));
        return;
      }
      state = const AuthUnauthenticated();
      rethrow;
    }
  }

  /// Leave the wrong-app screen: revoke any session and return to sign-in.
  Future<void> signOutFromWrongApp() async {
    if (state is AuthAuthenticated) {
      await logout();
    } else {
      state = const AuthUnauthenticated();
    }
  }

  UserRole? _roleFromDetails(Map<String, dynamic>? details) {
    final role = details?['role'];
    return role is String ? UserRole.fromApi(role) : null;
  }

  Future<void> logout() async {
    try {
      await _repo.logout();
    } catch (_) {
      // best-effort; clear locally regardless
    }
    await _session.clear();
    state = const AuthUnauthenticated();
  }

  /// Invoked by the dio interceptor after a refresh failure (tokens already cleared).
  void onSessionExpired() {
    state = const AuthUnauthenticated('session_expired');
  }
}
