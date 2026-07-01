import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/walkin/domain/walk_in_tenant.dart';

void main() {
  group('WalkInTenant.fromJson (renders the walk-in endpoint)', () {
    test('exposes only the last 4 Aadhaar digits and the payment mode', () {
      final w = WalkInTenant.fromJson({
        'id': 'w1',
        'name': 'Ravi',
        'phone': '+919812345678',
        'aadhaarLast4': '1234',
        'roomId': 'room-1',
        'roomName': 'Room A',
        'moveInDate': '2026-07-01T00:00:00.000Z',
        'monthlyRentPaise': 700000,
        'depositPaise': 700000,
        'paymentMode': 'UPI',
        'invited': true,
        'invitedAt': '2026-06-29T10:00:00.000Z',
        'checkedOutAt': null,
        'createdAt': '2026-06-29T09:00:00.000Z',
      });
      expect(w.aadhaarLast4, '1234'); // the full number never reaches the client
      expect(w.paymentMode, 'UPI');
      expect(w.monthlyRent.value, 700000);
      expect(w.invited, isTrue);
      expect(w.isResident, isTrue);
    });

    test('a checked-out walk-in is no longer resident', () {
      final w = WalkInTenant.fromJson({
        'id': 'w1',
        'name': 'Ravi',
        'phone': '+919812345678',
        'aadhaarLast4': '1234',
        'roomId': 'room-1',
        'roomName': 'Room A',
        'moveInDate': '2026-01-01T00:00:00.000Z',
        'monthlyRentPaise': 700000,
        'depositPaise': 0,
        'paymentMode': 'CASH',
        'invited': false,
        'invitedAt': null,
        'checkedOutAt': '2026-04-01T00:00:00.000Z',
        'createdAt': '2026-01-01T00:00:00.000Z',
      });
      expect(w.isResident, isFalse);
    });
  });

  test('paymentModeLabel is human-readable', () {
    expect(paymentModeLabel('BANK_TRANSFER'), 'Bank transfer');
    expect(paymentModeLabel('CASH'), 'Cash');
  });
}
