import 'models.dart';

sealed class AuthState {
  const AuthState();
}

class AuthUnknown extends AuthState {
  const AuthUnknown();
}

class AuthAuthenticating extends AuthState {
  const AuthAuthenticating();
}

class AuthAuthenticated extends AuthState {
  final SelfUser user;
  const AuthAuthenticated(this.user);
}

class AuthUnauthenticated extends AuthState {
  final String? reason;
  const AuthUnauthenticated([this.reason]);
}

/// The signed-in number's role isn't served by this app: the server returned
/// 403 WRONG_APP on verify, or (defense-in-depth) an authenticated role is no
/// longer allowed here. [role] is what the server reported, used to tailor the
/// wrong-app copy.
class AuthWrongApp extends AuthState {
  final UserRole? role;
  const AuthWrongApp([this.role]);
}
