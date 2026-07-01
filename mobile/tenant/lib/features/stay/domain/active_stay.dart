import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `ActiveStay` contract in `@roomadda/shared`. Returned by
/// `GET /v1/me/active-stay` ONLY when the tenant's CONFIRMED booking has reached
/// its move-in date; the repository maps a null response to `null` (no stay).
///
/// The host's [emergencyContactNumber] is allowed on the dashboard (per PRD) but
/// is NEVER used in chat. This shape carries no KYC or payment data — the server
/// does not send any, and the dashboard never asks for it.
class ActiveStay {
  final String bookingId;
  final String listingId;

  /// Real PG name — the server only unmasks it because the caller is a CONFIRMED
  /// tenant on this listing (masking is enforced server-side, see /CLAUDE.md).
  final String pgName;
  final String roomName;
  final DateTime moveInDate;
  final Paise monthlyRent;
  final DateTime nextRentDueDate;

  final String hostName;

  /// Host emergency contact — dashboard only (PRD). Do NOT surface this in chat.
  final String hostEmergencyContactNumber;

  final bool mealMenuAvailable;
  final bool leaveNoticeAvailable;

  const ActiveStay({
    required this.bookingId,
    required this.listingId,
    required this.pgName,
    required this.roomName,
    required this.moveInDate,
    required this.monthlyRent,
    required this.nextRentDueDate,
    required this.hostName,
    required this.hostEmergencyContactNumber,
    required this.mealMenuAvailable,
    required this.leaveNoticeAvailable,
  });

  factory ActiveStay.fromJson(Map<String, dynamic> json) {
    final host = json['host'] as Map<String, dynamic>;
    final features = json['features'] as Map<String, dynamic>;
    return ActiveStay(
      bookingId: json['bookingId'] as String,
      listingId: json['listingId'] as String,
      pgName: json['pgName'] as String,
      roomName: json['roomName'] as String,
      moveInDate: DateTime.parse(json['moveInDate'] as String),
      monthlyRent: Paise(json['monthlyRentPaise'] as int),
      nextRentDueDate: DateTime.parse(json['nextRentDueDate'] as String),
      hostName: host['name'] as String,
      hostEmergencyContactNumber: host['emergencyContactNumber'] as String,
      mealMenuAvailable: features['mealMenuAvailable'] as bool,
      leaveNoticeAvailable: features['leaveNoticeAvailable'] as bool,
    );
  }
}
