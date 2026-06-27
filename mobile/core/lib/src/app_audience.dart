import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/models.dart';

/// Which RoomAdda app this build is. Drives the server-side app gate (the
/// `appAudience` sent on OTP verify) and the set of roles the app's router
/// serves: the tenant app serves TENANT, the host_agent app serves HOST/AGENT.
/// Mirrors the backend audience map in `@roomadda/shared`.
enum AppAudience {
  tenant,
  hostAgent;

  /// Wire value for the backend (`appAudience` on POST /v1/auth/otp/verify).
  String get apiValue => this == AppAudience.tenant ? 'tenant' : 'host_agent';

  /// Roles this app may serve — used by the router gate's `allowedRoles`.
  Set<UserRole> get roles => this == AppAudience.tenant
      ? const {UserRole.tenant}
      : const {UserRole.host, UserRole.agent};
}

/// The current app's audience. Set once per app via a ProviderScope override in
/// `runRoomAddaApp`; reading it without that override is a programming error.
final Provider<AppAudience> appAudienceProvider = Provider<AppAudience>(
  (ref) => throw StateError(
    'appAudienceProvider must be overridden per app (see runRoomAddaApp)',
  ),
);
