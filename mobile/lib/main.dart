import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';
import 'core/error/app_error_widget.dart';
import 'core/error/crash_reporter.dart';

void main() {
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

      runApp(const ProviderScope(child: RoomAddaApp()));
    },
    (error, stack) => CrashReporter.recordError(error, stack, fatal: true),
  );
}
