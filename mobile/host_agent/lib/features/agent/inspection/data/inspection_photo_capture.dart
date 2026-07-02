import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../common/agent_location.dart';

/// A captured, geotagged inspection photo: compressed JPEG [bytes] plus the GPS
/// fix and capture time to attach. The geotag comes from the DEVICE at capture,
/// not the property record — that is the point of a geotagged inspection.
class CapturedPhoto {
  final Uint8List bytes;
  final String contentType;
  final double lat;
  final double lng;
  final DateTime takenAt;

  const CapturedPhoto({
    required this.bytes,
    required this.contentType,
    required this.lat,
    required this.lng,
    required this.takenAt,
  });
}

/// Why a capture did not produce a geotagged photo. Each maps to a clear message;
/// none is a crash.
enum CaptureFailure {
  cancelled,
  cameraDenied,
  locationUnavailable,
  error,
}

/// The outcome of a capture attempt — a photo or a reason.
class CaptureResult {
  const CaptureResult.success(this.photo)
      : failure = null,
        locationFailure = null;
  const CaptureResult.failed(this.failure, {this.locationFailure}) : photo = null;

  final CapturedPhoto? photo;
  final CaptureFailure? failure;

  /// Set only when [failure] is [CaptureFailure.locationUnavailable].
  final LocationFailure? locationFailure;

  bool get ok => photo != null;
}

/// Captures a photo from the camera and geotags it with the current GPS fix.
/// Behind an interface so the inspection flow can be exercised with a fake (no
/// platform plugins) — the real one uses image_picker + geolocator.
abstract class InspectionPhotoCapture {
  Future<CaptureResult> capture();
}

class DeviceInspectionPhotoCapture implements InspectionPhotoCapture {
  DeviceInspectionPhotoCapture(this._location, [ImagePicker? picker]) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;
  final LocationService _location;

  @override
  Future<CaptureResult> capture() async {
    // 1) Get the GPS fix FIRST — a photo without a geotag is useless here, and the
    //    backend requires lat/lng on every inspection photo.
    final loc = await _location.current();
    if (!loc.ok) {
      return CaptureResult.failed(CaptureFailure.locationUnavailable, locationFailure: loc.failure);
    }

    // 2) Capture from the camera. A denied CAMERA permission surfaces as a
    //    PlatformException we translate — never a crash.
    final XFile? file;
    try {
      file = await _picker.pickImage(source: ImageSource.camera, imageQuality: 70, maxWidth: 1600, maxHeight: 1600);
    } on PlatformException catch (e) {
      if (e.code == 'camera_access_denied') return const CaptureResult.failed(CaptureFailure.cameraDenied);
      return const CaptureResult.failed(CaptureFailure.error);
    } catch (_) {
      return const CaptureResult.failed(CaptureFailure.error);
    }
    if (file == null) return const CaptureResult.failed(CaptureFailure.cancelled);

    final bytes = await file.readAsBytes();
    final pos = loc.position!;
    return CaptureResult.success(CapturedPhoto(
      bytes: bytes,
      contentType: 'image/jpeg',
      lat: pos.latitude,
      lng: pos.longitude,
      takenAt: DateTime.now(),
    ));
  }
}

/// Copy for each capture failure.
String captureFailureMessage(CaptureResult result) => switch (result.failure!) {
      CaptureFailure.cancelled => 'Capture cancelled.',
      CaptureFailure.cameraDenied => 'Camera permission is needed to take inspection photos.',
      CaptureFailure.locationUnavailable =>
        result.locationFailure == null ? 'Location is needed to geotag the photo.' : locationFailureMessage(result.locationFailure!),
      CaptureFailure.error => 'Could not capture the photo. Try again.',
    };

final inspectionPhotoCaptureProvider = Provider<InspectionPhotoCapture>(
  (ref) => DeviceInspectionPhotoCapture(ref.read(locationServiceProvider)),
);
