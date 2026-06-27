import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import 'router.dart';

/// The Host & Agent app. Serves the HOST and AGENT roles; the role switch at the
/// router root sends HOST -> host shell and AGENT -> agent shell. Tenants are
/// bounced to the wrong-app screen (PRD: the two role UIs are fully distinct).
class HostAgentApp extends ConsumerWidget {
  const HostAgentApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'RoomAdda Partner',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}
