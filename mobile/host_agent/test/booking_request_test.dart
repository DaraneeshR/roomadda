import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/host/requests/domain/host_booking_request.dart';

Map<String, dynamic> _json({
  String status = 'PENDING_APPROVAL',
  bool instant = false,
  int? secondsRemaining = 7200,
  String? expiresAt = '2026-06-30T12:00:00.000Z',
}) =>
    {
      'bookingId': 'b1',
      'listingId': 'l1',
      'status': status,
      'instant': instant,
      'tenantName': 'Asha',
      'roomName': 'Room A',
      'bedLabel': 'B1',
      'tokenAmountPaise': 200000,
      'monthlyRentPaise': 800000,
      'moveInDate': '2026-07-01T00:00:00.000Z',
      'requestedAt': '2026-06-29T09:00:00.000Z',
      'expiresAt': expiresAt,
      'secondsRemaining': secondsRemaining,
    };

void main() {
  group('HostBookingRequest.fromJson (renders the requests feed)', () {
    test('parses a pending Request-to-Book and exposes NO tenant KYC', () {
      final r = HostBookingRequest.fromJson(_json());
      expect(r.tenantName, 'Asha'); // name only — there is no kyc field on the model
      expect(r.isPending, isTrue);
      expect(r.isExpired, isFalse);
      expect(r.tokenAmount.value, 200000);
    });

    test('an instant booking is shown confirmed (not actionable)', () {
      final r = HostBookingRequest.fromJson(
        _json(status: 'CONFIRMED', instant: true, secondsRemaining: null, expiresAt: null),
      );
      expect(r.instant, isTrue);
      expect(r.isConfirmed, isTrue);
      expect(r.isPending, isFalse);
    });

    test('a lapsed window marks the request expired', () {
      final r = HostBookingRequest.fromJson(_json(secondsRemaining: 0));
      expect(r.isExpired, isTrue);
    });
  });

  group('countdown + page rollups', () {
    test('formatCountdown is human and clamps at zero', () {
      expect(formatCountdown(7200), '2h 0m left');
      expect(formatCountdown(90), '1m left');
      expect(formatCountdown(0), 'Expired');
    });

    test('pendingCount excludes expired and confirmed', () {
      final page = HostBookingRequestPage(items: [
        HostBookingRequest.fromJson(_json()),
        HostBookingRequest.fromJson(_json(secondsRemaining: 0)),
        HostBookingRequest.fromJson(_json(status: 'CONFIRMED', instant: true, secondsRemaining: null)),
      ]);
      expect(page.pendingCount, 1);
    });
  });
}
