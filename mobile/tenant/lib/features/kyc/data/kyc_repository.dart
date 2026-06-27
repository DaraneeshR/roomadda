import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/kyc.dart';

/// A presigned upload target: the private object [key] we'll submit, and the
/// short-lived [uploadUrl] the client PUTs bytes to.
class UploadTarget {
  final String key;
  final String uploadUrl;

  const UploadTarget({required this.key, required this.uploadUrl});
}

class KycRepository {
  final Dio _dio;
  KycRepository(this._dio);

  /// The caller's KYC status (+ rejection reason). Backed by GET /v1/kyc/me.
  Future<KycView> fetchMine() async {
    final res = await _dio.get<dynamic>('/v1/kyc/me');
    return KycView.fromJson((res.data as Map<String, dynamic>)['kyc'] as Map<String, dynamic>);
  }

  /// Ask the server for a presigned PUT URL for one document slot.
  Future<UploadTarget> requestUploadUrl(KycSlot slot, String contentType) async {
    final res = await _dio.post<dynamic>(
      '/v1/kyc/upload-url',
      data: {'slot': slot.api, 'contentType': contentType},
    );
    final data = res.data as Map<String, dynamic>;
    return UploadTarget(key: data['key'] as String, uploadUrl: data['uploadUrl'] as String);
  }

  /// PUT the bytes straight to the private bucket. Uses a bare Dio (no base URL /
  /// auth interceptor) because the URL is fully-qualified and pre-authorized; the
  /// SSE header must match what the URL was signed with (AES-256).
  Future<void> uploadBytes(String uploadUrl, Uint8List bytes, String contentType) async {
    await Dio().put<dynamic>(
      uploadUrl,
      data: Stream<List<int>>.fromIterable([bytes]),
      options: Options(
        headers: {
          'Content-Type': contentType,
          'Content-Length': bytes.length,
          'x-amz-server-side-encryption': 'AES256',
        },
      ),
    );
  }

  /// Submit the three uploaded keys for review. The server stores PENDING and
  /// only an admin can flip it to VERIFIED. Returns the refreshed status.
  Future<KycView> submit({
    required String aadhaarFrontKey,
    required String aadhaarBackKey,
    required String supportingKey,
    required KycSupportingDocType supportingType,
    required String contentType,
  }) async {
    await _dio.post<dynamic>('/v1/kyc', data: {
      'aadhaarFront': {'key': aadhaarFrontKey, 'contentType': contentType},
      'aadhaarBack': {'key': aadhaarBackKey, 'contentType': contentType},
      'supporting': {'key': supportingKey, 'contentType': contentType, 'docType': supportingType.api},
    });
    return fetchMine();
  }
}

final kycRepositoryProvider = Provider<KycRepository>((ref) => KycRepository(ref.read(dioProvider)));
