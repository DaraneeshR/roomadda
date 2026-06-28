import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/booking/domain/move_in_date.dart';

void main() {
  final now = DateTime(2026, 6, 15, 10, 30);

  test('today is selectable (time of day ignored)', () {
    expect(isSelectableMoveInDate(DateTime(2026, 6, 15), now: now), isTrue);
    expect(isSelectableMoveInDate(DateTime(2026, 6, 15, 23, 59), now: now), isTrue);
  });

  test('future dates are selectable', () {
    expect(isSelectableMoveInDate(DateTime(2026, 6, 16), now: now), isTrue);
    expect(isSelectableMoveInDate(DateTime(2026, 12, 1), now: now), isTrue);
  });

  test('past dates are blocked', () {
    expect(isSelectableMoveInDate(DateTime(2026, 6, 14), now: now), isFalse);
    expect(isSelectableMoveInDate(DateTime(2026, 6, 14, 23, 59), now: now), isFalse);
    expect(isSelectableMoveInDate(DateTime(2025, 6, 15), now: now), isFalse);
  });

  test('firstSelectableMoveInDate is today at midnight', () {
    expect(firstSelectableMoveInDate(now), DateTime(2026, 6, 15));
  });
}
