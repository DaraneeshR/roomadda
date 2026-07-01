import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/host_service_request.dart';

/// Host service queue (escalated-first) + per-request actions. The host can
/// acknowledge / add a tenant-visible note / resolve — there is NO delete path
/// (a host can never delete a request). The serializer exposes only the tenant's
/// name and room — NO KYC.
class HostServiceRepository {
  final Dio _dio;
  HostServiceRepository(this._dio);

  Future<HostServiceQueue> queue({String? status, String? cursor, int limit = 30}) async {
    final res = await _dio.get<dynamic>(
      '/v1/host/service-requests',
      queryParameters: {
        'limit': limit,
        if (status != null) 'status': status,
        if (cursor != null) 'cursor': cursor,
      },
    );
    return HostServiceQueue.fromJson(res.data as Map<String, dynamic>);
  }

  Future<HostServiceRequest> detail(String id) => _get('/v1/host/service-requests/$id');

  Future<HostServiceRequest> acknowledge(String id) =>
      _post('/v1/host/service-requests/$id/acknowledge');

  Future<HostServiceRequest> resolve(String id) =>
      _post('/v1/host/service-requests/$id/resolve');

  Future<HostServiceRequest> addNote(String id, String note) =>
      _post('/v1/host/service-requests/$id/notes', data: {'note': note});

  Future<HostServiceRequest> _get(String path) async {
    final res = await _dio.get<dynamic>(path);
    return _request(res.data);
  }

  Future<HostServiceRequest> _post(String path, {Map<String, dynamic>? data}) async {
    final res = await _dio.post<dynamic>(path, data: data);
    return _request(res.data);
  }

  HostServiceRequest _request(dynamic data) =>
      HostServiceRequest.fromJson((data as Map<String, dynamic>)['request'] as Map<String, dynamic>);
}

final hostServiceRepositoryProvider =
    Provider<HostServiceRepository>((ref) => HostServiceRepository(ref.read(dioProvider)));
