import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/broadcast.dart';

/// Sends a broadcast to a property's current tenants. The cap (3/24h) and the
/// 280-char limit are enforced server-side; the response reports how many
/// recipients got it and how many sends remain today.
class BroadcastRepository {
  final Dio _dio;
  BroadcastRepository(this._dio);

  Future<BroadcastResult> send(String listingId, String body) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$listingId/broadcast', data: {'body': body});
    return BroadcastResult.fromJson(res.data as Map<String, dynamic>);
  }
}

final broadcastRepositoryProvider =
    Provider<BroadcastRepository>((ref) => BroadcastRepository(ref.read(dioProvider)));
