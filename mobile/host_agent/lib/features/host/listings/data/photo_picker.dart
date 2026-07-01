import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

/// One picked listing photo: compressed JPEG [bytes] + its [contentType].
class PickedPhoto {
  final Uint8List bytes;
  final String contentType;
  const PickedPhoto({required this.bytes, required this.contentType});
}

/// Picks a listing photo from the camera or gallery. An interface so the listing
/// form can be unit-tested with a fake (no platform plugin) while production uses
/// the real image picker — the same pattern as the tenant KYC DocumentPicker.
abstract class ListingPhotoPicker {
  Future<PickedPhoto?> pick(ImageSource source);
}

/// Real picker: compresses on capture (keeps each upload small with no visible
/// quality loss) and emits JPEG bytes.
class ImageListingPhotoPicker implements ListingPhotoPicker {
  ImageListingPhotoPicker([ImagePicker? picker]) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<PickedPhoto?> pick(ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      imageQuality: 70,
      maxWidth: 1600,
      maxHeight: 1600,
    );
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    return PickedPhoto(bytes: bytes, contentType: 'image/jpeg');
  }
}

final listingPhotoPickerProvider =
    Provider<ListingPhotoPicker>((ref) => ImageListingPhotoPicker());
