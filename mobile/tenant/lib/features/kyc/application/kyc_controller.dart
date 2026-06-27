import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import 'package:roomadda_core/roomadda_core.dart';
import '../data/document_picker.dart';
import '../data/kyc_repository.dart';
import '../domain/kyc.dart';

/// View state for the KYC screen. `view` is the server-owned status; the rest is
/// local capture progress until [submit] hands the keys to the server.
class KycEditState {
  final KycView? view;
  final bool loading;
  final String? error;

  /// Uploaded object keys per slot (populated as each upload completes).
  final Map<KycSlot, String> uploadedKeys;

  /// Slots whose upload is in flight (drives per-tile spinners).
  final Set<KycSlot> uploading;

  final KycSupportingDocType supportingType;
  final bool submitting;

  const KycEditState({
    this.view,
    this.loading = false,
    this.error,
    this.uploadedKeys = const {},
    this.uploading = const {},
    this.supportingType = KycSupportingDocType.studentId,
    this.submitting = false,
  });

  KycStatus get status => view?.status ?? KycStatus.notSubmitted;
  String? get rejectReason => view?.rejectReason;

  /// All three documents have been uploaded and are ready to submit.
  bool get allUploaded => KycSlot.values.every(uploadedKeys.containsKey);

  KycEditState copyWith({
    KycView? view,
    bool? loading,
    String? error,
    bool clearError = false,
    Map<KycSlot, String>? uploadedKeys,
    Set<KycSlot>? uploading,
    KycSupportingDocType? supportingType,
    bool? submitting,
  }) {
    return KycEditState(
      view: view ?? this.view,
      loading: loading ?? this.loading,
      error: clearError ? null : (error ?? this.error),
      uploadedKeys: uploadedKeys ?? this.uploadedKeys,
      uploading: uploading ?? this.uploading,
      supportingType: supportingType ?? this.supportingType,
      submitting: submitting ?? this.submitting,
    );
  }
}

/// Drives the KYC screen. Never decides VERIFIED itself — it only reads the
/// server status and uploads/submits documents (see /CLAUDE.md).
class KycController extends StateNotifier<KycEditState> {
  KycController(this._repo, this._picker) : super(const KycEditState());

  final KycRepository _repo;
  final DocumentPicker _picker;

  static const _contentType = 'image/jpeg';

  /// Load the current status from the server.
  Future<void> load() async {
    state = state.copyWith(loading: true, clearError: true);
    try {
      final view = await _repo.fetchMine();
      state = state.copyWith(view: view, loading: false);
    } catch (e) {
      state = state.copyWith(loading: false, error: apiExceptionFrom(e).message);
    }
  }

  void setSupportingType(KycSupportingDocType type) =>
      state = state.copyWith(supportingType: type);

  /// Pick (camera/gallery), compress, request a presigned URL, and upload one
  /// slot. A failure surfaces an error and clears the slot's spinner — never a
  /// crash; the user can retry that slot.
  Future<void> pickAndUpload(KycSlot slot, ImageSource source) async {
    final doc = await _picker.pick(source);
    if (doc == null) return; // user cancelled
    state = state.copyWith(uploading: {...state.uploading, slot}, clearError: true);
    try {
      final target = await _repo.requestUploadUrl(slot, doc.contentType);
      await _repo.uploadBytes(target.uploadUrl, doc.bytes, doc.contentType);
      state = state.copyWith(
        uploadedKeys: {...state.uploadedKeys, slot: target.key},
        uploading: state.uploading.difference({slot}),
      );
    } catch (e) {
      state = state.copyWith(
        uploading: state.uploading.difference({slot}),
        error: apiExceptionFrom(e).message,
      );
    }
  }

  /// Submit all three uploaded documents for review → server status PENDING.
  Future<void> submit() async {
    if (!state.allUploaded || state.submitting) return;
    state = state.copyWith(submitting: true, clearError: true);
    try {
      final view = await _repo.submit(
        aadhaarFrontKey: state.uploadedKeys[KycSlot.aadhaarFront]!,
        aadhaarBackKey: state.uploadedKeys[KycSlot.aadhaarBack]!,
        supportingKey: state.uploadedKeys[KycSlot.supporting]!,
        supportingType: state.supportingType,
        contentType: _contentType,
      );
      // Clear the local capture set once accepted; the server view now drives UI.
      state = state.copyWith(view: view, submitting: false, uploadedKeys: const {});
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiExceptionFrom(e).message);
    }
  }
}

final kycControllerProvider =
    StateNotifierProvider.autoDispose<KycController, KycEditState>(
  (ref) => KycController(ref.read(kycRepositoryProvider), ref.read(documentPickerProvider)),
);

/// One-shot status read for the pre-payment gate. Kept separate from the editor
/// so the booking screen can cheaply check + invalidate it without owning the
/// upload flow.
final kycStatusProvider =
    FutureProvider.autoDispose<KycView>((ref) => ref.read(kycRepositoryProvider).fetchMine());
