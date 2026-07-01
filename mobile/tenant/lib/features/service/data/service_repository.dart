import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/service_request.dart';

/// A presigned upload target: the private object [key] we'll attach, and the
/// short-lived [uploadUrl] the client PUTs bytes to (same pattern as KYC).
class PhotoUploadTarget {
  final String key;
  final String uploadUrl;
  const PhotoUploadTarget({required this.key, required this.uploadUrl});
}

/// Talks to the tenant service-request endpoints. Status is server-owned; the
/// app reads/refetches it and never mutates it (the host/admin drive Acknowledged
/// / Resolved). Tenants can comment but never delete (no delete endpoint exists).
class ServiceRepository {
  final Dio _dio;
  ServiceRepository(this._dio);

  Future<ServiceRequestPage> listMine({String? cursor, int limit = 20, String? status}) async {
    final res = await _dio.get<dynamic>(
      '/v1/service-requests',
      queryParameters: {'limit': limit, if (cursor != null) 'cursor': cursor, if (status != null) 'status': status},
    );
    final data = res.data as Map<String, dynamic>;
    return ServiceRequestPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => ServiceRequest.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<ServiceRequest> fetchDetail(String id) async {
    final res = await _dio.get<dynamic>('/v1/service-requests/$id');
    return ServiceRequest.fromJson((res.data as Map<String, dynamic>)['request'] as Map<String, dynamic>);
  }

  /// Raise a ticket against the caller's active stay (the server resolves which).
  Future<ServiceRequest> create({
    required String category,
    required String description,
    required String priority,
    List<String> photoRefs = const [],
  }) async {
    final res = await _dio.post<dynamic>('/v1/service-requests', data: {
      'category': category,
      'description': description,
      'priority': priority,
      'photoRefs': photoRefs,
    });
    return ServiceRequest.fromJson((res.data as Map<String, dynamic>)['request'] as Map<String, dynamic>);
  }

  Future<ServiceRequest> addComment(String id, String body) async {
    final res = await _dio.post<dynamic>('/v1/service-requests/$id/comments', data: {'body': body});
    return ServiceRequest.fromJson((res.data as Map<String, dynamic>)['request'] as Map<String, dynamic>);
  }

  /// Submit the 1–5 rating (accepted server-side only once RESOLVED).
  Future<ServiceRequest> rate(String id, int rating) async {
    final res = await _dio.post<dynamic>('/v1/service-requests/$id/rating', data: {'rating': rating});
    return ServiceRequest.fromJson((res.data as Map<String, dynamic>)['request'] as Map<String, dynamic>);
  }

  /// Ask the server for a presigned PUT URL for one photo.
  Future<PhotoUploadTarget> requestPhotoUrl(String contentType) async {
    final res = await _dio.post<dynamic>('/v1/service-requests/photo-url', data: {'contentType': contentType});
    final data = res.data as Map<String, dynamic>;
    return PhotoUploadTarget(key: data['key'] as String, uploadUrl: data['uploadUrl'] as String);
  }

  /// PUT the bytes straight to the private bucket (bare Dio: the URL is fully
  /// qualified and pre-authorized; the SSE header must match the signature).
  Future<void> uploadBytes(String uploadUrl, Uint8List bytes, String contentType) async {
    await Dio().put<dynamic>(
      uploadUrl,
      data: Stream<List<int>>.fromIterable([bytes]),
      options: Options(headers: {
        'Content-Type': contentType,
        'Content-Length': bytes.length,
        'x-amz-server-side-encryption': 'AES256',
      }),
    );
  }
}

final serviceRepositoryProvider = Provider<ServiceRepository>((ref) => ServiceRepository(ref.read(dioProvider)));
