import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/menu/domain/meal_menu.dart';

void main() {
  group('MealMenuDay.fromJson (renders the menu editor)', () {
    test('parses a filled day with slots and transparency fields', () {
      final d = MealMenuDay.fromJson({
        'date': '2026-06-30T00:00:00.000Z',
        'breakfast': {'text': 'Idli', 'notAvailable': false},
        'lunch': {'text': null, 'notAvailable': true},
        'dinner': {'text': 'Roti, dal', 'notAvailable': false},
        'updatedByHostName': 'Host',
        'updatedAt': '2026-06-29T20:00:00.000Z',
        'notUpdated': false,
      });
      expect(d.breakfast.text, 'Idli');
      expect(d.lunch.notAvailable, isTrue);
      expect(d.lunch.isEmpty, isFalse, reason: 'explicitly not-served is not "empty"');
      expect(d.notUpdated, isFalse);
    });

    test('parses an empty/not-updated day', () {
      final d = MealMenuDay.fromJson({
        'date': '2026-07-01T00:00:00.000Z',
        'breakfast': {'text': null, 'notAvailable': false},
        'lunch': {'text': null, 'notAvailable': false},
        'dinner': {'text': null, 'notAvailable': false},
        'updatedByHostName': null,
        'updatedAt': null,
        'notUpdated': true,
      });
      expect(d.notUpdated, isTrue);
      expect(d.breakfast.isEmpty, isTrue);
    });
  });

  group('MealSlot wire shape', () {
    test('toJson omits null text but always sends notAvailable', () {
      expect(const MealSlot(text: null, notAvailable: true).toJson(), {'notAvailable': true});
      expect(const MealSlot(text: 'Poha').toJson(), {'text': 'Poha', 'notAvailable': false});
    });
  });

  group('MealTemplate.fromJson (renders saved templates)', () {
    test('parses all 7 weekdays', () {
      WeeklyMenuDay slot() => const WeeklyMenuDay(
            breakfast: MealSlot(text: 'A'),
            lunch: MealSlot(text: 'B'),
            dinner: MealSlot(text: 'C'),
          );
      final days = {for (final wd in weekdays) wd: {'breakfast': {'text': 'A', 'notAvailable': false}, 'lunch': {'text': 'B', 'notAvailable': false}, 'dinner': {'text': 'C', 'notAvailable': false}}};
      final t = MealTemplate.fromJson({
        'id': 't1',
        'name': 'Standard week',
        'days': days,
        'createdAt': '2026-06-01T00:00:00.000Z',
        'updatedAt': '2026-06-01T00:00:00.000Z',
      });
      expect(t.name, 'Standard week');
      expect(t.days.keys, containsAll(weekdays));
      expect(t.days['mon']!.breakfast.text, 'A');
      // sanity: the helper builds a consistent day
      expect(slot().lunch.text, 'B');
    });
  });
}
