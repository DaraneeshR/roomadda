import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';

/// Wraps Firebase Crashlytics. Initialisation is guarded so the app still runs
/// before `flutterfire configure` has generated the platform config — in that
/// case errors are logged locally instead of crashing the app.
class CrashReporter {
  CrashReporter._();

  static bool _enabled = false;
  static bool get enabled => _enabled;

  static Future<void> init() async {
    try {
      await Firebase.initializeApp();
      await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(!kDebugMode);
      _enabled = true;
    } catch (_) {
      _enabled = false; // no firebase_options / google-services.json yet
    }
  }

  static void recordFlutterError(FlutterErrorDetails details) {
    if (_enabled) {
      FirebaseCrashlytics.instance.recordFlutterFatalError(details);
    } else {
      FlutterError.presentError(details);
    }
  }

  static Future<void> recordError(Object error, StackTrace? stack, {bool fatal = false}) async {
    if (_enabled) {
      await FirebaseCrashlytics.instance.recordError(error, stack, fatal: fatal);
    } else {
      debugPrint('Uncaught error: $error\n$stack');
    }
  }
}
