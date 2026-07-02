import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/inspection_photo_capture.dart';
import '../data/inspection_repository.dart';
import '../domain/inspection.dart';

/// Sentinel so copyWith can distinguish "leave unchanged" from "set to null".
const Object _unset = Object();

/// The editable inspection draft. [inspection] is the last server copy (photos,
/// status, ids); the rest are the agent's in-progress checklist entries, seeded
/// from the draft on load and partial-saved back.
@immutable
class InspectionEditState {
  const InspectionEditState({
    this.inspection,
    this.amenities = const {},
    this.roomCountListed,
    this.roomCountActual,
    this.cleanliness = const {},
    this.securityInfra = const {},
    this.discrepancies = '',
    this.recommendation,
    this.notesForAdmin = '',
    this.loading = true,
    this.saving = false,
    this.capturing = false,
    this.submitting = false,
    this.loadError,
    this.notice,
    this.submitted = false,
  });

  final Inspection? inspection;
  final Map<String, AmenityCheck> amenities;
  final int? roomCountListed;
  final int? roomCountActual;
  final Map<String, int> cleanliness;
  final Map<String, bool> securityInfra;
  final String discrepancies;
  final InspectionRecommendation? recommendation;
  final String notesForAdmin;
  final bool loading;
  final bool saving;
  final bool capturing;
  final bool submitting;
  final String? loadError;
  final String? notice;
  final bool submitted;

  int get photoCount => inspection?.photos.length ?? 0;
  bool get locked => inspection != null && inspection!.isSubmitted;

  /// Required fields still missing (mirrors the backend's submit check).
  List<String> get missingRequiredFields {
    final missing = <String>[];
    if (recommendation == null) missing.add('recommendation');
    if (roomCountActual == null) missing.add('actual room count');
    if (amenities.isEmpty) missing.add('amenity checks');
    if (cleanliness.isEmpty) missing.add('cleanliness ratings');
    return missing;
  }

  bool canSubmit(bool hasValidCheckIn) => InspectionGate.canSubmit(
        hasValidCheckIn: hasValidCheckIn,
        photoCount: photoCount,
        hasRequiredFields: missingRequiredFields.isEmpty,
      );

  List<String> submitBlockers(bool hasValidCheckIn) => InspectionGate.blockers(
        hasValidCheckIn: hasValidCheckIn,
        photoCount: photoCount,
        missingFields: missingRequiredFields,
      );

  InspectionEditState copyWith({
    Object? inspection = _unset,
    Map<String, AmenityCheck>? amenities,
    Object? roomCountListed = _unset,
    Object? roomCountActual = _unset,
    Map<String, int>? cleanliness,
    Map<String, bool>? securityInfra,
    String? discrepancies,
    Object? recommendation = _unset,
    String? notesForAdmin,
    bool? loading,
    bool? saving,
    bool? capturing,
    bool? submitting,
    Object? loadError = _unset,
    Object? notice = _unset,
    bool? submitted,
  }) {
    return InspectionEditState(
      inspection: inspection == _unset ? this.inspection : inspection as Inspection?,
      amenities: amenities ?? this.amenities,
      roomCountListed: roomCountListed == _unset ? this.roomCountListed : roomCountListed as int?,
      roomCountActual: roomCountActual == _unset ? this.roomCountActual : roomCountActual as int?,
      cleanliness: cleanliness ?? this.cleanliness,
      securityInfra: securityInfra ?? this.securityInfra,
      discrepancies: discrepancies ?? this.discrepancies,
      recommendation:
          recommendation == _unset ? this.recommendation : recommendation as InspectionRecommendation?,
      notesForAdmin: notesForAdmin ?? this.notesForAdmin,
      loading: loading ?? this.loading,
      saving: saving ?? this.saving,
      capturing: capturing ?? this.capturing,
      submitting: submitting ?? this.submitting,
      loadError: loadError == _unset ? this.loadError : loadError as String?,
      notice: notice == _unset ? this.notice : notice as String?,
      submitted: submitted ?? this.submitted,
    );
  }
}

/// Drives one visit's inspection: load/resume the draft, edit the checklist,
/// capture geotagged photos (presign → upload → attach), partial-save, and submit.
/// Submit is server-gated; this mirrors the gate locally only so the button
/// reflects reality — the server is the authority.
class InspectionController extends StateNotifier<InspectionEditState> {
  InspectionController(this._repo, this._capture, this._visitId)
      : super(const InspectionEditState());

  final InspectionRepository _repo;
  final InspectionPhotoCapture _capture;
  final String _visitId;

  Future<void> load() async {
    state = state.copyWith(loading: true, loadError: null);
    try {
      final inspection = await _repo.getDraft(_visitId);
      state = _seed(inspection);
    } catch (e) {
      state = state.copyWith(loading: false, loadError: apiExceptionFrom(e).message);
    }
  }

  /// Seed editable fields from a server draft (or leave empty for a fresh one).
  InspectionEditState _seed(Inspection? inspection) {
    if (inspection == null) return const InspectionEditState(loading: false);
    return InspectionEditState(
      inspection: inspection,
      amenities: Map.of(inspection.amenities ?? const {}),
      roomCountListed: inspection.roomCountListed,
      roomCountActual: inspection.roomCountActual,
      cleanliness: Map.of(inspection.cleanliness ?? const {}),
      securityInfra: Map.of(inspection.securityInfra ?? const {}),
      discrepancies: inspection.discrepancies ?? '',
      recommendation: inspection.recommendation,
      notesForAdmin: inspection.notesForAdmin ?? '',
      loading: false,
    );
  }

  // ---- Field edits (local; persisted via saveDraft) -----------------------
  void setAmenity(String name, AmenityCheck value) =>
      state = state.copyWith(amenities: {...state.amenities, name: value}, notice: null);

  void setCleanliness(String area, int score) =>
      state = state.copyWith(cleanliness: {...state.cleanliness, area: score}, notice: null);

  void setSecurity(String item, bool present) =>
      state = state.copyWith(securityInfra: {...state.securityInfra, item: present}, notice: null);

  void setRoomCountListed(int? value) => state = state.copyWith(roomCountListed: value, notice: null);
  void setRoomCountActual(int? value) => state = state.copyWith(roomCountActual: value, notice: null);
  void setDiscrepancies(String value) => state = state.copyWith(discrepancies: value, notice: null);
  void setRecommendation(InspectionRecommendation value) =>
      state = state.copyWith(recommendation: value, notice: null);
  void setNotes(String value) => state = state.copyWith(notesForAdmin: value, notice: null);

  /// The patch of set fields to persist. `null` when nothing is fillable (the PUT
  /// requires at least one field).
  Map<String, dynamic>? _draftPatch() {
    final patch = <String, dynamic>{};
    if (state.amenities.isNotEmpty) {
      patch['amenities'] = state.amenities.map((k, v) => MapEntry(k, v.api));
    }
    if (state.roomCountListed != null) patch['roomCountListed'] = state.roomCountListed;
    if (state.roomCountActual != null) patch['roomCountActual'] = state.roomCountActual;
    if (state.cleanliness.isNotEmpty) patch['cleanliness'] = state.cleanliness;
    if (state.securityInfra.isNotEmpty) patch['securityInfra'] = state.securityInfra;
    if (state.discrepancies.trim().isNotEmpty) patch['discrepancies'] = state.discrepancies.trim();
    if (state.recommendation != null) patch['recommendation'] = state.recommendation!.api;
    if (state.notesForAdmin.trim().isNotEmpty) patch['notesForAdmin'] = state.notesForAdmin.trim();
    return patch.isEmpty ? null : patch;
  }

  /// Partial-save the current checklist. Returns true on success (or nothing to
  /// save). A submitted inspection is locked.
  Future<bool> saveDraft() async {
    if (state.locked) return false;
    final patch = _draftPatch();
    if (patch == null) {
      state = state.copyWith(notice: 'Fill in a field before saving.');
      return false;
    }
    state = state.copyWith(saving: true, notice: null);
    try {
      final inspection = await _repo.saveDraft(_visitId, patch);
      state = state.copyWith(inspection: inspection, saving: false, notice: 'Draft saved.');
      return true;
    } catch (e) {
      state = state.copyWith(saving: false, notice: apiExceptionFrom(e).message);
      return false;
    }
  }

  /// Capture one geotagged photo and attach it to the draft (presign → upload →
  /// attach). Every failure surfaces a clear message, never a crash.
  Future<void> capturePhoto() async {
    if (state.locked || state.capturing) return;
    state = state.copyWith(capturing: true, notice: null);
    final result = await _capture.capture();
    if (!result.ok) {
      state = state.copyWith(capturing: false, notice: captureFailureMessage(result));
      return;
    }
    try {
      final photo = result.photo!;
      final target = await _repo.presignPhoto(_visitId, photo.contentType);
      await _repo.uploadBytes(target.uploadUrl, photo.bytes, photo.contentType);
      final inspection = await _repo.addPhoto(
        _visitId,
        key: target.key,
        lat: photo.lat,
        lng: photo.lng,
        takenAt: photo.takenAt,
      );
      state = state.copyWith(
        inspection: inspection,
        capturing: false,
        notice: 'Photo added (${inspection.photos.length} of $kMinInspectionPhotos).',
      );
    } catch (e) {
      state = state.copyWith(capturing: false, notice: apiExceptionFrom(e).message);
    }
  }

  /// Submit into the admin queue. Blocks locally when the gate is unmet; otherwise
  /// persists the draft, then submits. The server re-checks every gate — a 4xx is
  /// surfaced verbatim (the client never self-approves).
  Future<void> submit({required bool hasValidCheckIn}) async {
    if (state.locked || state.submitting) return;
    if (!state.canSubmit(hasValidCheckIn)) {
      state = state.copyWith(notice: state.submitBlockers(hasValidCheckIn).join(' '));
      return;
    }
    state = state.copyWith(submitting: true, notice: null);
    try {
      // Persist the latest field edits first so submit validates against them.
      final patch = _draftPatch();
      if (patch != null) await _repo.saveDraft(_visitId, patch);
      final inspection = await _repo.submit(_visitId);
      state = state.copyWith(inspection: inspection, submitting: false, submitted: true, notice: null);
    } catch (e) {
      state = state.copyWith(submitting: false, notice: apiExceptionFrom(e).message);
    }
  }
}

final inspectionControllerProvider =
    StateNotifierProvider.autoDispose.family<InspectionController, InspectionEditState, String>((ref, visitId) {
  final controller = InspectionController(
    ref.read(inspectionRepositoryProvider),
    ref.read(inspectionPhotoCaptureProvider),
    visitId,
  );
  controller.load();
  return controller;
});
