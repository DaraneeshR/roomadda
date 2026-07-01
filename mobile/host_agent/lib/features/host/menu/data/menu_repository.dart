import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/meal_menu.dart';

/// Host meal-menu manager. Reads today+tomorrow via the shared menu endpoint and
/// writes a single day via the host write endpoint (limited server-side to
/// today/tomorrow). Weekly templates plan further ahead. A `date` is sent as a
/// plain ISO date (UTC midnight) to match the `@db.Date` column.
class MenuRepository {
  final Dio _dio;
  MenuRepository(this._dio);

  /// Today + tomorrow for a listing (the shared read endpoint).
  Future<List<MealMenuDay>> twoDayMenu(String listingId) async {
    final res = await _dio.get<dynamic>('/v1/listings/$listingId/menu');
    return ((res.data as Map<String, dynamic>)['days'] as List<dynamic>)
        .map((e) => MealMenuDay.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Write one day's three slots. [date] must be today or tomorrow (UTC).
  Future<MealMenuDay> writeDay(
    String listingId, {
    required DateTime date,
    MealSlot? breakfast,
    MealSlot? lunch,
    MealSlot? dinner,
  }) async {
    final res = await _dio.put<dynamic>('/v1/host/listings/$listingId/menu', data: {
      'date': _isoDate(date),
      if (breakfast != null) 'breakfast': breakfast.toJson(),
      if (lunch != null) 'lunch': lunch.toJson(),
      if (dinner != null) 'dinner': dinner.toJson(),
    });
    return MealMenuDay.fromJson((res.data as Map<String, dynamic>)['day'] as Map<String, dynamic>);
  }

  Future<List<MealTemplate>> listTemplates(String listingId) async {
    final res = await _dio.get<dynamic>('/v1/host/listings/$listingId/menu-templates');
    return ((res.data as Map<String, dynamic>)['items'] as List<dynamic>)
        .map((e) => MealTemplate.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<MealTemplate> saveTemplate(String listingId, {required String name, required Map<String, WeeklyMenuDay> days}) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$listingId/menu-templates', data: {
      'name': name,
      'days': {for (final entry in days.entries) entry.key: entry.value.toJson()},
    });
    return MealTemplate.fromJson((res.data as Map<String, dynamic>)['template'] as Map<String, dynamic>);
  }

  Future<void> deleteTemplate(String listingId, String templateId) async {
    await _dio.delete<dynamic>('/v1/host/listings/$listingId/menu-templates/$templateId');
  }

  /// Apply a template to the week starting [weekStartDate]; returns days filled.
  Future<int> applyTemplate(String listingId, {required String templateId, required DateTime weekStartDate}) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$listingId/menu-templates/apply', data: {
      'templateId': templateId,
      'weekStartDate': _isoDate(weekStartDate),
    });
    return (res.data as Map<String, dynamic>)['daysFilled'] as int;
  }

  /// `YYYY-MM-DD` in UTC — the backend coerces it to a UTC-midnight @db.Date.
  String _isoDate(DateTime d) {
    final u = DateTime.utc(d.year, d.month, d.day);
    return u.toIso8601String().split('T').first;
  }
}

final menuRepositoryProvider =
    Provider<MenuRepository>((ref) => MenuRepository(ref.read(dioProvider)));
