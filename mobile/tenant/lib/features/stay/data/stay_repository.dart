import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/active_stay.dart';

/// Reads the tenant's current active stay. Backed by the caller-scoped
/// `GET /v1/me/active-stay`: the server returns `{ activeStay: null }` until the
/// CONFIRMED booking reaches its move-in date, then the stay payload. The app
/// never decides "moved in" itself — the server gates it on moveInDate <= today.
class StayRepository {
  final Dio _dio;
  StayRepository(this._dio);

  /// The current active stay, or null when there is none (pre-move-in / no stay).
  Future<ActiveStay?> fetchActiveStay() async {
    final res = await _dio.get<dynamic>('/v1/me/active-stay');
    final stay = (res.data as Map<String, dynamic>)['activeStay'];
    return stay == null ? null : ActiveStay.fromJson(stay as Map<String, dynamic>);
  }
}

final stayRepositoryProvider = Provider<StayRepository>((ref) => StayRepository(ref.read(dioProvider)));
