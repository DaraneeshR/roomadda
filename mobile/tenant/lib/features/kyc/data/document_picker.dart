import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../domain/kyc.dart';

/// Picks a document from the camera or gallery. An interface so the KYC flow can
/// be unit-tested with a fake (no platform plugin) while production uses the
/// real image picker.
abstract class DocumentPicker {
  Future<PickedDoc?> pick(ImageSource source);
}

/// Real picker: compresses on capture via `imageQuality`/`maxWidth` (keeps the
/// upload around ~2 MB with no visible quality loss) and emits JPEG bytes.
class ImagePickerDocumentPicker implements DocumentPicker {
  ImagePickerDocumentPicker([ImagePicker? picker]) : _picker = picker ?? ImagePicker();

  final ImagePicker _picker;

  @override
  Future<PickedDoc?> pick(ImageSource source) async {
    final file = await _picker.pickImage(
      source: source,
      imageQuality: 70,
      maxWidth: 1600,
      maxHeight: 1600,
    );
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    return PickedDoc(bytes: bytes, contentType: 'image/jpeg');
  }
}

final documentPickerProvider = Provider<DocumentPicker>((ref) => ImagePickerDocumentPicker());
