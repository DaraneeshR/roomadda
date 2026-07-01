import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/leave_notice.dart';

/// Talks to the leave-notice endpoints. The notice-period and 3-day-withdraw
/// rules are enforced SERVER-side; the app sends the date and renders the result.
class LeaveNoticeRepository {
  final Dio _dio;
  LeaveNoticeRepository(this._dio);

  Future<LeaveNoticeView> fetchMine() async {
    final res = await _dio.get<dynamic>('/v1/leave-notices');
    return LeaveNoticeView.fromJson(res.data as Map<String, dynamic>);
  }

  Future<LeaveNotice> submit(DateTime moveOutDate) async {
    final res = await _dio.post<dynamic>('/v1/leave-notices', data: {
      'moveOutDate': moveOutDate.toIso8601String(),
    });
    return LeaveNotice.fromJson((res.data as Map<String, dynamic>)['notice'] as Map<String, dynamic>);
  }

  Future<LeaveNotice> withdraw(String id) async {
    final res = await _dio.post<dynamic>('/v1/leave-notices/$id/withdraw');
    return LeaveNotice.fromJson((res.data as Map<String, dynamic>)['notice'] as Map<String, dynamic>);
  }
}

final leaveNoticeRepositoryProvider =
    Provider<LeaveNoticeRepository>((ref) => LeaveNoticeRepository(ref.read(dioProvider)));
