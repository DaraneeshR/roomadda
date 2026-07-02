import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/inspection.dart';

/// A presigned PUT target for one inspection photo. Inspection photos live in the
/// PRIVATE bucket, so only a short-lived [uploadUrl] + object [key] come back — no
/// public URL. The key is scoped to the visit server-side (a forged key is 400).
class InspectionPhotoTarget {
  final String key;
  final String uploadUrl;

  const InspectionPhotoTarget({required this.key, required this.uploadUrl});
}

/// Talks to the agent inspection endpoints (`/v1/agent/visits/:id/inspection*`).
/// Partial-save/resume, geotagged-photo upload (presigned), and submit. Submit is
/// server-gated (valid check-in + >=8 photos + required fields); the client just
/// surfaces the server's verdict.
class InspectionRepository {
  final Dio _dio;
  InspectionRepository(this._dio);

  /// Resume an inspection draft (null if not started).
  Future<Inspection?> getDraft(String visitId) async {
    final res = await _dio.get<dynamic>('/v1/agent/visits/$visitId/inspection');
    final data = (res.data as Map<String, dynamic>)['inspection'];
    return data == null ? null : Inspection.fromJson(data as Map<String, dynamic>);
  }

  /// Partial-save the checklist (DRAFT). [patch] must carry at least one field.
  Future<Inspection> saveDraft(String visitId, Map<String, dynamic> patch) async {
    final res = await _dio.put<dynamic>('/v1/agent/visits/$visitId/inspection', data: patch);
    return Inspection.fromJson((res.data as Map<String, dynamic>)['inspection'] as Map<String, dynamic>);
  }

  /// Ask the server for a presigned PUT URL for one photo (jpeg/png only).
  Future<InspectionPhotoTarget> presignPhoto(String visitId, String contentType) async {
    final res = await _dio.post<dynamic>(
      '/v1/agent/visits/$visitId/inspection/photo-url',
      data: {'contentType': contentType},
    );
    final data = res.data as Map<String, dynamic>;
    return InspectionPhotoTarget(key: data['key'] as String, uploadUrl: data['uploadUrl'] as String);
  }

  /// PUT the bytes straight to the PRIVATE bucket. Bare Dio (the URL is fully
  /// qualified + pre-authorized); the SSE header must match what the URL was
  /// signed with (AES-256), exactly like the tenant KYC upload.
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

  /// Attach an uploaded, geotagged + timestamped photo to the draft.
  Future<Inspection> addPhoto(
    String visitId, {
    required String key,
    required double lat,
    required double lng,
    required DateTime takenAt,
  }) async {
    final res = await _dio.post<dynamic>(
      '/v1/agent/visits/$visitId/inspection/photos',
      data: {'key': key, 'lat': lat, 'lng': lng, 'takenAt': takenAt.toUtc().toIso8601String()},
    );
    return Inspection.fromJson((res.data as Map<String, dynamic>)['inspection'] as Map<String, dynamic>);
  }

  /// Submit the inspection into the admin review queue. Server-gated — a failed
  /// gate returns a 4xx the caller surfaces (never a client-side self-approve).
  Future<Inspection> submit(String visitId) async {
    final res = await _dio.post<dynamic>('/v1/agent/visits/$visitId/inspection/submit');
    return Inspection.fromJson((res.data as Map<String, dynamic>)['inspection'] as Map<String, dynamic>);
  }
}

final inspectionRepositoryProvider =
    Provider<InspectionRepository>((ref) => InspectionRepository(ref.read(dioProvider)));
