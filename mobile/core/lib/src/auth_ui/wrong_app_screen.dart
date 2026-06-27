import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_state.dart';
import '../auth/models.dart';
import '../providers.dart';

/// Shown when a number's role isn't served by this app — either the server
/// rejected verify with 403 WRONG_APP ([AuthWrongApp]) or a signed-in user's
/// role is no longer allowed here (defense-in-depth). The copy names the role
/// and points to the app that role belongs to. It never decides access itself;
/// the router gate routes here.
class WrongAppScreen extends ConsumerWidget {
  const WrongAppScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final role = switch (auth) {
      AuthWrongApp(:final role) => role,
      AuthAuthenticated(:final user) => user.role,
      _ => null,
    };
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.app_blocking_outlined, size: 56),
              const SizedBox(height: 16),
              Text(
                wrongAppMessageFor(role),
                style: Theme.of(context).textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).signOutFromWrongApp(),
                child: const Text('Use a different number'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Role-driven copy for the wrong-app screen: names the role the number is
/// registered as and the app that role belongs to. Shared by the server-rejected
/// and defense-in-depth paths so the wording lives in one place.
String wrongAppMessageFor(UserRole? role) => switch (role) {
      UserRole.host =>
        'This number is registered as a host. Please use the RoomAdda Host & Agent app.',
      UserRole.agent =>
        'This number is registered as an agent. Please use the RoomAdda Host & Agent app.',
      UserRole.tenant =>
        'This number is registered as a tenant. Please use the RoomAdda Tenant app.',
      UserRole.admin =>
        'This number is registered as an administrator. Please sign in on the RoomAdda web console.',
      null =>
        'This number is not registered for this app. Please use the RoomAdda app for your role.',
    };
