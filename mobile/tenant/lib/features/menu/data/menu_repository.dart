import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/meal_menu.dart';

/// Reads a listing's meal menu (today + tomorrow). Sends the device's LOCAL
/// calendar date as `?date=` so "today" is correct in India regardless of the
/// server's timezone; the server returns that day plus the next.
class MenuRepository {
  final Dio _dio;
  MenuRepository(this._dio);

  Future<List<MealMenuDay>> fetchMenu(String listingId, {DateTime? date}) async {
    final res = await _dio.get<dynamic>(
      '/v1/listings/$listingId/menu',
      queryParameters: {if (date != null) 'date': _dateParam(date)},
    );
    final days = (res.data as Map<String, dynamic>)['days'] as List<dynamic>;
    return days.map((e) => MealMenuDay.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// `YYYY-MM-DD` from the date's LOCAL fields (no UTC conversion).
  static String _dateParam(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

final menuRepositoryProvider = Provider<MenuRepository>((ref) => MenuRepository(ref.read(dioProvider)));
