import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `HostBookingRequest` contract. A Request-to-Book hold
/// (PENDING_APPROVAL) is actionable with a 24h countdown ([secondsRemaining]);
/// an Instant-Book booking appears already-confirmed. The host NEVER sees the
/// tenant's KYC — only their display name (enforced server-side in the serializer,
/// /CLAUDE.md domain rule #4). There is deliberately no KYC field on this model.
class HostBookingRequest {
  final String bookingId;
  final String listingId;
  final String status;
  final bool instant;
  final String tenantName;
  final String roomName;
  final String bedLabel;
  final Paise tokenAmount;
  final Paise monthlyRent;
  final DateTime? moveInDate;
  final DateTime requestedAt;
  final DateTime? expiresAt;
  final int? secondsRemaining;

  const HostBookingRequest({
    required this.bookingId,
    required this.listingId,
    required this.status,
    required this.instant,
    required this.tenantName,
    required this.roomName,
    required this.bedLabel,
    required this.tokenAmount,
    required this.monthlyRent,
    required this.requestedAt,
    this.moveInDate,
    this.expiresAt,
    this.secondsRemaining,
  });

  /// Only a pending Request-to-Book is host-actionable (accept / decline).
  bool get isPending => status == 'PENDING_APPROVAL';
  bool get isConfirmed => status == 'CONFIRMED';

  /// True once the 24h host-accept window has lapsed (no longer acceptable).
  bool get isExpired => isPending && (secondsRemaining ?? 0) <= 0;

  factory HostBookingRequest.fromJson(Map<String, dynamic> json) => HostBookingRequest(
        bookingId: json['bookingId'] as String,
        listingId: json['listingId'] as String,
        status: json['status'] as String,
        instant: json['instant'] as bool,
        tenantName: json['tenantName'] as String,
        roomName: json['roomName'] as String,
        bedLabel: json['bedLabel'] as String,
        tokenAmount: Paise(json['tokenAmountPaise'] as int),
        monthlyRent: Paise(json['monthlyRentPaise'] as int),
        moveInDate: _date(json['moveInDate']),
        requestedAt: DateTime.parse(json['requestedAt'] as String),
        expiresAt: _date(json['expiresAt']),
        secondsRemaining: json['secondsRemaining'] as int?,
      );
}

class HostBookingRequestPage {
  final List<HostBookingRequest> items;
  final String? nextCursor;

  const HostBookingRequestPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;

  int get pendingCount => items.where((b) => b.isPending && !b.isExpired).length;
}

DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String);

/// Human "Xh Ym left" from a remaining-seconds count (clamped at 0).
String formatCountdown(int seconds) {
  if (seconds <= 0) return 'Expired';
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  if (h > 0) return '${h}h ${m}m left';
  if (m > 0) return '${m}m left';
  return '<1m left';
}
