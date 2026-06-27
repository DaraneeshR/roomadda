import 'dart:typed_data';

/// KYC status as the app cares about it. `notSubmitted` is the client-only
/// "no record yet" case the server returns as NOT_SUBMITTED. Status is
/// SERVER-OWNED — the app only ever reads it (see /CLAUDE.md: payment truth and
/// verification are server-side; the client never self-verifies).
enum KycStatus { notSubmitted, pending, verified, rejected }

KycStatus kycStatusFromApi(String value) => switch (value) {
      'PENDING' => KycStatus.pending,
      'VERIFIED' => KycStatus.verified,
      'REJECTED' => KycStatus.rejected,
      _ => KycStatus.notSubmitted,
    };

/// The caller's KYC view from `GET /v1/kyc/me`.
class KycView {
  final KycStatus status;
  final String? rejectReason;

  const KycView({required this.status, this.rejectReason});

  bool get isVerified => status == KycStatus.verified;

  /// The upload form is shown when there is nothing pending/verified to wait on.
  bool get canSubmit => status == KycStatus.notSubmitted || status == KycStatus.rejected;

  factory KycView.fromJson(Map<String, dynamic> json) => KycView(
        status: kycStatusFromApi(json['status'] as String),
        rejectReason: json['rejectReason'] as String?,
      );
}

/// The three documents the server requires (Aadhaar front/back + one supporting ID).
enum KycSlot { aadhaarFront, aadhaarBack, supporting }

extension KycSlotX on KycSlot {
  /// Wire value expected by the API (`kycSlotSchema` in @roomadda/shared).
  String get api => switch (this) {
        KycSlot.aadhaarFront => 'aadhaar_front',
        KycSlot.aadhaarBack => 'aadhaar_back',
        KycSlot.supporting => 'supporting',
      };

  String get label => switch (this) {
        KycSlot.aadhaarFront => 'Aadhaar — front',
        KycSlot.aadhaarBack => 'Aadhaar — back',
        KycSlot.supporting => 'Supporting ID',
      };
}

/// What the supporting ID is (mirrors `kycSupportingDocTypeSchema`).
enum KycSupportingDocType { studentId, officeId, offerLetter }

extension KycSupportingDocTypeX on KycSupportingDocType {
  String get api => switch (this) {
        KycSupportingDocType.studentId => 'STUDENT_ID',
        KycSupportingDocType.officeId => 'OFFICE_ID',
        KycSupportingDocType.offerLetter => 'OFFER_LETTER',
      };

  String get label => switch (this) {
        KycSupportingDocType.studentId => 'Student ID',
        KycSupportingDocType.officeId => 'Office ID',
        KycSupportingDocType.offerLetter => 'Offer letter',
      };
}

/// A picked-and-compressed document ready to upload. Bytes never touch the API —
/// they go straight to the private bucket via a presigned URL.
class PickedDoc {
  final Uint8List bytes;
  final String contentType;

  const PickedDoc({required this.bytes, required this.contentType});
}
