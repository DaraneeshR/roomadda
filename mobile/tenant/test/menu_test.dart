import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/menu/domain/meal_menu.dart';

Map<String, dynamic> _slot({String? text, bool notAvailable = false}) =>
    {'text': text, 'notAvailable': notAvailable};

Map<String, dynamic> _day({
  bool notUpdated = false,
  Map<String, dynamic>? breakfast,
  Map<String, dynamic>? lunch,
  Map<String, dynamic>? dinner,
  String? updatedByHostName,
  String? updatedAt,
}) =>
    {
      'date': '2026-06-28T00:00:00.000Z',
      'breakfast': breakfast ?? _slot(),
      'lunch': lunch ?? _slot(),
      'dinner': dinner ?? _slot(),
      'updatedByHostName': updatedByHostName,
      'updatedAt': updatedAt,
      'notUpdated': notUpdated,
    };

void main() {
  group('MealSlot', () {
    test('a filled slot has a dish to show', () {
      expect(MealSlot.fromJson(_slot(text: 'Poha & chai')).hasDish, isTrue);
    });

    test('an empty slot renders not-available (no dish)', () {
      expect(MealSlot.fromJson(_slot()).hasDish, isFalse);
      expect(MealSlot.fromJson(_slot(text: '   ')).hasDish, isFalse);
    });

    test('an explicitly not-available slot has no dish', () {
      final slot = MealSlot.fromJson(_slot(notAvailable: true));
      expect(slot.notAvailable, isTrue);
      expect(slot.hasDish, isFalse);
    });
  });

  group('MealMenuDay.fromJson', () {
    test('parses a populated day with last-updated info', () {
      final day = MealMenuDay.fromJson(_day(
        breakfast: _slot(text: 'Poha & chai'),
        lunch: _slot(notAvailable: true),
        updatedByHostName: 'Menu Host',
        updatedAt: '2026-06-28T08:30:00.000Z',
      ));
      expect(day.notUpdated, isFalse);
      expect(day.breakfast.hasDish, isTrue);
      expect(day.lunch.hasDish, isFalse); // marked not available
      expect(day.dinner.hasDish, isFalse); // never filled → not available
      expect(day.updatedByHostName, 'Menu Host');
      expect(day.updatedAt, isNotNull);
    });

    test('a day with no menu is flagged not-updated with empty slots', () {
      final day = MealMenuDay.fromJson(_day(notUpdated: true));
      expect(day.notUpdated, isTrue);
      expect(day.breakfast.hasDish, isFalse);
      expect(day.lunch.hasDish, isFalse);
      expect(day.dinner.hasDish, isFalse);
      expect(day.updatedByHostName, isNull);
      expect(day.updatedAt, isNull);
    });
  });
}
