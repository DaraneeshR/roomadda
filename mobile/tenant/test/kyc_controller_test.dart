import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:roomadda_tenant/features/kyc/application/kyc_controller.dart';
import 'package:roomadda_tenant/features/kyc/data/document_picker.dart';
import 'package:roomadda_tenant/features/kyc/data/kyc_repository.dart';
import 'package:roomadda_tenant/features/kyc/domain/kyc.dart';

/// Scripted repo: serves a fixed status on fetch; submit() flips it to PENDING
/// (the server's behaviour) and records the submission.
class _FakeKycRepo implements KycRepository {
  _FakeKycRepo(this.current);

  KycView current;
  int submitCount = 0;

  @override
  Future<KycView> fetchMine() async => current;

  @override
  Future<UploadTarget> requestUploadUrl(KycSlot slot, String contentType) async =>
      UploadTarget(key: 'kyc/u/${slot.api}-x.jpg', uploadUrl: 'https://stub.local/${slot.api}');

  @override
  Future<void> uploadBytes(String uploadUrl, Uint8List bytes, String contentType) async {}

  @override
  Future<KycView> submit({
    required String aadhaarFrontKey,
    required String aadhaarBackKey,
    required String supportingKey,
    required KycSupportingDocType supportingType,
    required String contentType,
  }) async {
    submitCount++;
    current = const KycView(status: KycStatus.pending);
    return current;
  }
}

class _FakePicker implements DocumentPicker {
  @override
  Future<PickedDoc?> pick(ImageSource source) async =>
      PickedDoc(bytes: Uint8List.fromList([1, 2, 3]), contentType: 'image/jpeg');
}

Future<void> _uploadAll(KycController c) async {
  for (final slot in KycSlot.values) {
    await c.pickAndUpload(slot, ImageSource.gallery);
  }
}

void main() {
  test('load surfaces NOT_SUBMITTED when the tenant has no record', () async {
    final c = KycController(_FakeKycRepo(const KycView(status: KycStatus.notSubmitted)), _FakePicker());
    await c.load();
    expect(c.state.status, KycStatus.notSubmitted);
  });

  test('uploading all three docs then submitting flips to PENDING', () async {
    final repo = _FakeKycRepo(const KycView(status: KycStatus.notSubmitted));
    final c = KycController(repo, _FakePicker());
    await c.load();

    await _uploadAll(c);
    expect(c.state.allUploaded, isTrue);

    await c.submit();
    expect(repo.submitCount, 1);
    expect(c.state.status, KycStatus.pending);
    // The local capture set is cleared once the server has accepted it.
    expect(c.state.allUploaded, isFalse);
  });

  test('the controller never self-verifies — submit only ever yields PENDING', () async {
    final c = KycController(_FakeKycRepo(const KycView(status: KycStatus.notSubmitted)), _FakePicker());
    await c.load();
    await _uploadAll(c);
    await c.submit();
    expect(c.state.status, isNot(KycStatus.verified));
  });

  test('a rejection exposes the reason and allows re-upload back to PENDING', () async {
    final repo = _FakeKycRepo(const KycView(status: KycStatus.rejected, rejectReason: 'Aadhaar photo is blurry'));
    final c = KycController(repo, _FakePicker());
    await c.load();

    expect(c.state.status, KycStatus.rejected);
    expect(c.state.rejectReason, 'Aadhaar photo is blurry');
    expect(c.state.view!.canSubmit, isTrue); // re-upload is allowed

    await _uploadAll(c);
    await c.submit();
    expect(c.state.status, KycStatus.pending);
    expect(c.state.rejectReason, isNull);
  });
}
