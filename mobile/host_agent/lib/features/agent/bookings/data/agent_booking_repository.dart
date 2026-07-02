import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/agent_booking.dart';
import '../domain/booking_room.dart';

/// Agent-created bookings. BOTH channels send the payable moment to the USER's own
/// device — assisted = SMS/WhatsApp pay link; walk-in = a Razorpay QR the user
/// scans. There is deliberately NO "pay" method here: the agent's pay attempt is
/// 403'd server-side, and the UI must not expose it at all (/CLAUDE.md rule #2).
class AgentBookingRepository {
  final Dio _dio;
  AgentBookingRepository(this._dio);

  /// Create an assisted booking → the server sends a pay link to the USER and
  /// returns only a MASKED phone + status. No payable order comes back to the agent.
  Future<AssistedBookingResult> createAssisted({
    required String tenantName,
    required String tenantPhone,
    String? roomId,
    String? bedId,
    DateTime? moveInDate,
  }) async {
    final res = await _dio.post<dynamic>('/v1/agent/assisted-bookings', data: _body(tenantName, tenantPhone, roomId, bedId, moveInDate));
    return AssistedBookingResult.fromJson(res.data as Map<String, dynamic>);
  }

  /// Create a walk-in booking → returns the Razorpay order the USER scans as a QR.
  /// Confirmation is via the verified webhook ONLY (never a client callback).
  Future<WalkInBookingResult> createWalkIn({
    required String tenantName,
    required String tenantPhone,
    String? roomId,
    String? bedId,
    DateTime? moveInDate,
  }) async {
    final res = await _dio.post<dynamic>('/v1/agent/walkin-bookings', data: _body(tenantName, tenantPhone, roomId, bedId, moveInDate));
    return WalkInBookingResult.fromJson(res.data as Map<String, dynamic>);
  }

  /// The live server status of a walk-in the agent created — the poll target for
  /// confirmation. Reads THIS booking's own status (GET /v1/agent/bookings/:id,
  /// webhook-driven), so a confirm reflects exactly this booking settling, never an
  /// aggregate counter another in-scope confirmation would move. A booking the
  /// agent did not create is a 404 (surfaced as a poll error, never a false confirm).
  Future<WalkInServerStatus> walkInStatus(String bookingId) async {
    final res = await _dio.get<dynamic>('/v1/agent/bookings/$bookingId');
    final status = (res.data as Map<String, dynamic>)['status'] as String;
    return status == 'CONFIRMED' ? WalkInServerStatus.confirmed : WalkInServerStatus.pending;
  }

  /// The bookable rooms of an in-zone listing (agents see the private shape, which
  /// includes room ids + availability). Used to populate the room picker — the
  /// agent books by ROOM, the server picks the bed under a row lock.
  Future<List<BookingRoom>> listingRooms(String listingId) async {
    final res = await _dio.get<dynamic>('/v1/listings/$listingId');
    final listing = (res.data as Map<String, dynamic>)['listing'] as Map<String, dynamic>;
    final rooms = (listing['rooms'] as List<dynamic>? ?? const []);
    return rooms.map((e) => BookingRoom.fromJson(e as Map<String, dynamic>)).toList();
  }

  Map<String, dynamic> _body(String name, String phone, String? roomId, String? bedId, DateTime? moveIn) => {
        'tenantName': name,
        'tenantPhone': phone,
        if (roomId != null) 'roomId': roomId,
        if (bedId != null) 'bedId': bedId,
        if (moveIn != null) 'moveInDate': DateTime.utc(moveIn.year, moveIn.month, moveIn.day).toIso8601String(),
      };
}

final agentBookingRepositoryProvider =
    Provider<AgentBookingRepository>((ref) => AgentBookingRepository(ref.read(dioProvider)));
