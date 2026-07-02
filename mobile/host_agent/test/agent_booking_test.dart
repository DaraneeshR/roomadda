import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/bookings/domain/agent_booking.dart';
import 'package:roomadda_host_agent/features/agent/bookings/domain/booking_room.dart';

void main() {
  group('AssistedBookingResult.fromJson', () {
    // The exact backend shape (see agent.service.createAssistedBooking): a MASKED
    // phone + status, and crucially NO payable order.
    final json = {
      'bookingId': 'b1',
      'status': 'TOKEN_PENDING',
      'tenantId': 't1',
      'agentChannel': 'ASSISTED',
      'tokenAmountPaise': 500000,
      'payLinkSentTo': '+9198xxxxxx21',
      'expiresAt': '2026-07-01T12:00:00.000Z',
    };

    test('parses the masked phone + token amount', () {
      final r = AssistedBookingResult.fromJson(json);
      expect(r.payLinkSentTo, '+9198xxxxxx21');
      expect(r.payLinkSentTo, contains('x')); // masked, never the full number
      expect(r.tokenAmount.value, 500000);
      expect(r.agentChannel, 'ASSISTED');
    });

    test('link status derives sent / paid / expired from status + expiry', () {
      final r = AssistedBookingResult.fromJson(json);
      // Before expiry, still pending → "sent".
      expect(r.linkStatus(now: DateTime.utc(2026, 7, 1, 10)), LinkStatus.sent);
      // After the window → "expired".
      expect(r.linkStatus(now: DateTime.utc(2026, 7, 1, 13)), LinkStatus.expired);
      // Confirmed → "paid".
      final paid = AssistedBookingResult.fromJson({...json, 'status': 'CONFIRMED'});
      expect(paid.linkStatus(now: DateTime.utc(2026, 7, 1, 10)), LinkStatus.paid);
    });

    test('NO pay action: the assisted result exposes no payable order or pay URL', () {
      final r = AssistedBookingResult.fromJson(json);
      // The backend response itself carries no payable order for the agent…
      expect(json.containsKey('razorpayOrder'), isFalse);
      // …and the model has no such member (the agent side cannot pay at all).
      expect(() => (r as dynamic).razorpayOrder, throwsNoSuchMethodError);
      expect(() => (r as dynamic).payUrl, throwsNoSuchMethodError);
      expect(() => (r as dynamic).pay(), throwsNoSuchMethodError);
    });
  });

  group('WalkInBookingResult.fromJson', () {
    final json = {
      'bookingId': 'b2',
      'status': 'TOKEN_PENDING',
      'tenantId': 't2',
      'agentChannel': 'WALK_IN',
      'tokenAmountPaise': 500000,
      'razorpayOrder': {'orderId': 'order_ABC', 'amount': 500000, 'currency': 'INR', 'keyId': 'rzp_test_1'},
      'expiresAt': null,
    };

    test('parses the Razorpay order the USER scans', () {
      final r = WalkInBookingResult.fromJson(json);
      expect(r.razorpayOrder.orderId, 'order_ABC');
      expect(r.razorpayOrder.amountPaise, 500000);
      expect(r.razorpayOrder.keyId, 'rzp_test_1');
      expect(r.agentChannel, 'WALK_IN');
    });

    test('payUrl encodes the order for the user-facing pay page (not an agent pay action)', () {
      final r = WalkInBookingResult.fromJson(json);
      // The QR points the USER's device at the hosted pay page for this order.
      expect(r.payUrl, contains('/pay/b2'));
      expect(r.payUrl, contains('order=order_ABC'));
    });
  });

  group('BookingRoom.fromJson', () {
    test('parses vacancy + rent for the room picker', () {
      final room = BookingRoom.fromJson({
        'id': 'room-1',
        'name': 'Room A',
        'sharingType': 'DOUBLE',
        'monthlyRentPaise': 800000,
        'depositPaise': 800000,
        'totalBeds': 2,
        'availableBeds': 1,
      });
      expect(room.hasVacancy, isTrue);
      expect(room.monthlyRent.value, 800000);
      final full = BookingRoom.fromJson({
        'id': 'room-2',
        'name': 'Room B',
        'sharingType': 'SINGLE',
        'monthlyRentPaise': 1200000,
        'depositPaise': 1200000,
        'totalBeds': 1,
        'availableBeds': 0,
      });
      expect(full.hasVacancy, isFalse);
    });
  });
}
