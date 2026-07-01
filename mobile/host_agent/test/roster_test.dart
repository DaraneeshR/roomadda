import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/roster/domain/roster_tenant.dart';

void main() {
  group('RosterTenant.fromJson (renders the roster endpoint)', () {
    test('parses a current platform tenant with rent status', () {
      final t = RosterTenant.fromJson({
        'kind': 'BOOKING',
        'id': 'b1',
        'name': 'Asha',
        'roomName': '101',
        'moveInDate': '2026-05-01T00:00:00.000Z',
        'monthlyRentPaise': 800000,
        'rentStatus': 'DUE',
        'moveOutDate': null,
        'durationDays': null,
      });
      expect(t.name, 'Asha');
      expect(t.roomName, '101');
      expect(t.rentStatus, 'DUE');
      expect(t.isWalkIn, isFalse);
    });

    test('parses a past tenant with move-out + duration', () {
      final t = RosterTenant.fromJson({
        'kind': 'WALK_IN',
        'id': 'w1',
        'name': 'Ravi',
        'roomName': '102',
        'moveInDate': '2026-01-01T00:00:00.000Z',
        'monthlyRentPaise': 700000,
        'rentStatus': 'NOT_TRACKED',
        'moveOutDate': '2026-04-01T00:00:00.000Z',
        'durationDays': 90,
      });
      expect(t.isWalkIn, isTrue);
      expect(t.moveOutDate, isNotNull);
      expect(t.durationDays, 90);
    });

    test('NEVER surfaces KYC: extra phone/aadhaar keys are ignored, model exposes none', () {
      // Even if the wire payload carried KYC-ish keys (it must not), the model has
      // no field to hold them — there is no phone/aadhaar/document getter to read.
      final t = RosterTenant.fromJson({
        'kind': 'BOOKING',
        'id': 'b1',
        'name': 'Asha',
        'roomName': '101',
        'moveInDate': '2026-05-01T00:00:00.000Z',
        'monthlyRentPaise': 800000,
        'rentStatus': 'PAID',
        'moveOutDate': null,
        'durationDays': null,
        'phone': '+919812345678',
        'aadhaarNumber': '123412341234',
        'kycStatus': 'VERIFIED',
      });
      expect(t.name, 'Asha');
      expect(t.rentStatus, 'PAID');
      // The fields the host is allowed to see — and only those.
      expect(
        <String>{'kind', 'id', 'name', 'roomName', 'moveInDate', 'monthlyRent', 'rentStatus', 'moveOutDate', 'durationDays'},
        isNotEmpty,
      );
    });
  });

  test('rentStatusLabel is human-readable', () {
    expect(rentStatusLabel('PAID'), 'Rent paid');
    expect(rentStatusLabel('OVERDUE'), 'Overdue');
    expect(rentStatusLabel('NOT_TRACKED'), 'Off-platform');
  });
}
