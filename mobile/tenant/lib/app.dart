import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'router.dart';

/// The Tenant app. Serves the TENANT role only (admins use the web console);
/// any other role is bounced to the wrong-app screen by the shared router gate.
class TenantApp extends ConsumerWidget {
  const TenantApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'RoomAdda',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}
