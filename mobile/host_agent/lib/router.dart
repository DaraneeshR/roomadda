import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'features/agent/presentation/agent_shell.dart';
import 'features/host/presentation/host_shell.dart';

/// Host & Agent router. The role switch at the root sends HOST -> `/host` and
/// AGENT -> `/agent`; any other role hits the shared wrong-app gate. The two
/// route subtrees are preserved verbatim from the original single-app router.
final routerProvider = Provider<GoRouter>((ref) {
  return createRouter(
    ref,
    allowedRoles: AppAudience.hostAgent.roles,
    roleHome: (role) => role == UserRole.host ? '/host' : '/agent',
    appRoutes: [
      GoRoute(path: '/host', builder: (_, __) => const HostShell()),
      GoRoute(path: '/agent', builder: (_, __) => const AgentShell()),
    ],
  );
});
