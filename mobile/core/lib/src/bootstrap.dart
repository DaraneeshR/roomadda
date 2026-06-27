import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_audience.dart';
import 'error/app_error_widget.dart';
import 'error/crash_reporter.dart';

/// Boots a RoomAdda app inside a guarded zone with crash reporting wired up.
/// Both apps share this entrypoint; the per-app differences are the [app] widget
/// and its [audience] (which app this build is — drives the server app gate and
/// the router's allowed roles). This is the original single-app `main()` with
/// the app widget + audience lifted into parameters.
void runRoomAddaApp(Widget app, {required AppAudience audience}) {
  // Top-level guard: any uncaught async error is reported, never a silent crash.
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      // Optional .env (also configurable via --dart-define). Missing file is fine.
      try {
        await dotenv.load(fileName: '.env');
      } catch (_) {
        // no .env bundled — fall back to --dart-define / defaults
      }

      await CrashReporter.init();

      FlutterError.onError = CrashReporter.recordFlutterError;
      PlatformDispatcher.instance.onError = (error, stack) {
        CrashReporter.recordError(error, stack, fatal: true);
        return true;
      };
      ErrorWidget.builder = (details) =>
          AppErrorWidget(message: kReleaseMode ? null : details.exceptionAsString());

      runApp(ProviderScope(
        overrides: [appAudienceProvider.overrideWithValue(audience)],
        child: app,
      ));
    },
    (error, stack) => CrashReporter.recordError(error, stack, fatal: true),
  );
}
