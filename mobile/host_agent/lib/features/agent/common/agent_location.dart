import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

/// Why a location fix could not be obtained — each maps to a clear, non-crashing
/// message in the UI (permissions handled gracefully, never a hard failure).
enum LocationFailure {
  /// Device location services are switched off.
  serviceDisabled,

  /// The user denied the runtime permission this time.
  permissionDenied,

  /// The user selected "Don't ask again" / denied forever (send them to settings).
  permissionDeniedForever,

  /// Timed out or the plugin threw — transient, retryable.
  unavailable,
}

/// A GPS fix or the reason we could not get one. Never throws — the caller
/// switches on [failure] and shows a message instead of crashing.
class LocationResult {
  const LocationResult.success(this.position) : failure = null;
  const LocationResult.failed(this.failure) : position = null;

  final Position? position;
  final LocationFailure? failure;

  bool get ok => position != null;
}

/// Thin wrapper over `geolocator` that folds the permission dance into a single
/// result type. Behind an interface so the check-in / photo-geotag flows can be
/// unit-tested with a fake (no platform plugin) while production uses the device.
abstract class LocationService {
  Future<LocationResult> current({Duration timeout});
}

class GeolocatorLocationService implements LocationService {
  const GeolocatorLocationService();

  @override
  Future<LocationResult> current({Duration timeout = const Duration(seconds: 12)}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return const LocationResult.failed(LocationFailure.serviceDisabled);
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.deniedForever) {
        return const LocationResult.failed(LocationFailure.permissionDeniedForever);
      }
      if (perm == LocationPermission.denied) {
        return const LocationResult.failed(LocationFailure.permissionDenied);
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
      );
      return LocationResult.success(pos);
    } catch (_) {
      // A timeout / plugin error is transient — surface a retry, never a crash.
      return const LocationResult.failed(LocationFailure.unavailable);
    }
  }
}

/// Human-readable, actionable copy for each failure.
String locationFailureMessage(LocationFailure failure) => switch (failure) {
      LocationFailure.serviceDisabled =>
        'Location is turned off. Enable location services to check in.',
      LocationFailure.permissionDenied =>
        'Location permission is needed to check in at the property.',
      LocationFailure.permissionDeniedForever =>
        'Location permission is blocked. Enable it in Settings to check in.',
      LocationFailure.unavailable =>
        'Could not get a GPS fix. Move to open sky and try again.',
    };

final locationServiceProvider =
    Provider<LocationService>((ref) => const GeolocatorLocationService());
