import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../features/agent/presentation/agent_shell.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/splash_screen.dart';
import '../../features/booking/presentation/booking_payment_screen.dart';
import '../../features/host/presentation/host_shell.dart';
import '../../features/tenant/presentation/tenant_shell.dart';
import '../auth/auth_state.dart';
import '../auth/models.dart';
import '../providers.dart';

String roleHome(UserRole role) => switch (role) {
      UserRole.host => '/host',
      UserRole.agent => '/agent',
      _ => '/tenant', // tenant (and admin -> use the web console)
    };

String? _redirectForRole(UserRole role, String loc) {
  final home = roleHome(role);
  if (loc == '/splash' || loc == '/login') return home;
  // Keep each role within its own subtree.
  if (!loc.startsWith(home)) return home;
  return null;
}

final routerProvider = Provider<GoRouter>((ref) {
  // Tick the router whenever auth state changes so `redirect` re-runs.
  final refresh = ValueNotifier<int>(0);
  ref.onDispose(refresh.dispose);
  ref.listen<AuthState>(authControllerProvider, (_, __) => refresh.value++);

  return GoRouter(
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final loc = state.matchedLocation;
      return switch (auth) {
        AuthUnknown() => loc == '/splash' ? null : '/splash',
        AuthAuthenticating() => null,
        AuthUnauthenticated() => loc == '/login' ? null : '/login',
        AuthAuthenticated(:final user) => _redirectForRole(user.role, loc),
      };
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(
        path: '/tenant',
        builder: (_, __) => const TenantShell(),
        routes: [
          GoRoute(
            path: 'booking/:bedId/pay',
            builder: (context, state) => BookingPaymentScreen(bedId: state.pathParameters['bedId']!),
          ),
        ],
      ),
      GoRoute(path: '/host', builder: (_, __) => const HostShell()),
      GoRoute(path: '/agent', builder: (_, __) => const AgentShell()),
    ],
  );
});
