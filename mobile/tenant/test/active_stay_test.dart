import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/discovery/presentation/discovery_shell.dart';
import 'package:roomadda_tenant/features/stay/domain/active_stay.dart';
import 'package:roomadda_tenant/features/stay/presentation/stay_dashboard_screen.dart';
import 'package:roomadda_tenant/features/stay/presentation/tenant_home_shell.dart';

Map<String, dynamic> _stayJson() => {
      'bookingId': 'b1',
      'listingId': 'l1',
      'pgName': 'Sunrise Residency',
      'roomName': 'Room 101',
      'moveInDate': '2026-06-01T00:00:00.000Z',
      'monthlyRentPaise': 1200000,
      'nextRentDueDate': '2026-07-01T00:00:00.000Z',
      'host': {'name': 'Host Hema', 'emergencyContactNumber': '+919812345678'},
      'features': {'mealMenuAvailable': true, 'leaveNoticeAvailable': true},
    };

ActiveStay _stay() => ActiveStay.fromJson(_stayJson());

void main() {
  group('ActiveStay.fromJson', () {
    test('parses the dashboard fields, including the host emergency contact', () {
      final stay = _stay();
      expect(stay.bookingId, 'b1');
      expect(stay.pgName, 'Sunrise Residency');
      expect(stay.roomName, 'Room 101');
      expect(stay.monthlyRent.value, 1200000);
      expect(stay.hostName, 'Host Hema');
      expect(stay.hostEmergencyContactNumber, '+919812345678');
      expect(stay.mealMenuAvailable, isTrue);
      expect(stay.leaveNoticeAvailable, isTrue);
      expect(stay.nextRentDueDate.isAfter(stay.moveInDate), isTrue);
    });
  });

  group('tenantHomeFor (auto-activation)', () {
    test('shows the dashboard once the server reports an active stay', () {
      final home = tenantHomeFor(AsyncData<ActiveStay?>(_stay()));
      expect(home, isA<StayDashboardScreen>());
    });

    test('shows the browse shell when there is no active stay', () {
      final home = tenantHomeFor(const AsyncData<ActiveStay?>(null));
      expect(home, isA<DiscoveryShell>());
    });

    test('keeps browsing available while the stay is still loading', () {
      final home = tenantHomeFor(const AsyncLoading<ActiveStay?>());
      expect(home, isA<DiscoveryShell>());
    });

    test('keeps browsing available if the stay lookup errors', () {
      final home = tenantHomeFor(const AsyncError<ActiveStay?>('boom', StackTrace.empty));
      expect(home, isA<DiscoveryShell>());
    });
  });
}
