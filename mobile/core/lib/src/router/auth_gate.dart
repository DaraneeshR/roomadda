import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_state.dart';
import '../auth/models.dart';
import '../auth_ui/login_screen.dart';
import '../auth_ui/splash_screen.dart';
import '../auth_ui/wrong_app_screen.dart';
import '../providers.dart';

/// The shared auth redirect. Mirrors the original single-app gate — bounce to
/// `/splash` while auth is unknown, `/login` when signed out, and keep an
/// authenticated user inside their own home subtree — and adds the wrong-app
/// branch: a role this app does not serve is sent to [WrongAppScreen] (PRD: a
/// tenant never sees host/agent features, and vice-versa).
String? authRedirect({
  required AuthState auth,
  required String location,
  required Set<UserRole> allowedRoles,
  required String Function(UserRole) roleHome,
}) {
  return switch (auth) {
    AuthUnknown() => location == '/splash' ? null : '/splash',
    AuthAuthenticating() => null,
    AuthUnauthenticated() => location == '/login' ? null : '/login',
    AuthWrongApp() => location == '/wrong-app' ? null : '/wrong-app',
    AuthAuthenticated(:final user) =>
      _redirectForRole(user.role, location, allowedRoles, roleHome),
  };
}

String? _redirectForRole(
  UserRole role,
  String location,
  Set<UserRole> allowedRoles,
  String Function(UserRole) roleHome,
) {
  // A role this app doesn't serve never reaches a feature route.
  if (!allowedRoles.contains(role)) {
    return location == '/wrong-app' ? null : '/wrong-app';
  }
  final home = roleHome(role);
  if (location == '/splash' || location == '/login' || location == '/wrong-app') {
    return home;
  }
  // Keep each role within its own subtree.
  if (!location.startsWith(home)) return home;
  return null;
}

/// Builds an app's [GoRouter]: the shared splash/login/wrong-app routes plus the
/// app-specific [appRoutes], all guarded by [authRedirect]. The router re-runs
/// `redirect` whenever auth state changes. Each app supplies the roles it serves
/// and how those roles map to a home location. This is the original
/// `routerProvider` wiring, parameterized so each app owns its own route tree.
GoRouter createRouter(
  Ref ref, {
  required List<RouteBase> appRoutes,
  required Set<UserRole> allowedRoles,
  required String Function(UserRole) roleHome,
}) {
  // Tick the router whenever auth state changes so `redirect` re-runs.
  final refresh = ValueNotifier<int>(0);
  ref.onDispose(refresh.dispose);
  ref.listen<AuthState>(authControllerProvider, (_, __) => refresh.value++);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) => authRedirect(
      auth: ref.read(authControllerProvider),
      location: state.matchedLocation,
      allowedRoles: allowedRoles,
      roleHome: roleHome,
    ),
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/wrong-app', builder: (_, __) => const WrongAppScreen()),
      ...appRoutes,
    ],
  );
}
