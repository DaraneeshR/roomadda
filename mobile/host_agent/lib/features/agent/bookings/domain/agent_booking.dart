import 'package:roomadda_core/roomadda_core.dart';

/// Where an assisted-booking pay link currently stands, as far as the agent can
/// see. Derived from the booking status + hold expiry — the agent NEVER sees or
/// touches a payable order; only whether the USER's link was sent / paid / expired.
enum LinkStatus {
  sent,
  paid,
  expired;

  String get label => switch (this) {
        LinkStatus.sent => 'Sent — awaiting payment',
        LinkStatus.paid => 'Paid',
        LinkStatus.expired => 'Expired',
      };
}

/// Result of POST /v1/agent/assisted-bookings.
///
/// CRITICAL (see /CLAUDE.md rule #2 + the agent spec): the agent CANNOT pay for
/// the user. This model deliberately carries NO payable order — only the MASKED
/// destination phone the link was sent to and the booking status. There is no
/// field, getter, or method here that could initiate or represent a payment. The
/// booking confirms ONLY via the signature-verified Razorpay webhook.
class AssistedBookingResult {
  final String bookingId;
  final String status;
  final String tenantId;
  final String agentChannel; // ASSISTED
  final Paise tokenAmount;

  /// The MASKED phone the pay link was sent to, e.g. "+9198xxxxxx21". Never the
  /// full number, never a payable link the agent could open.
  final String payLinkSentTo;

  final DateTime? expiresAt;

  const AssistedBookingResult({
    required this.bookingId,
    required this.status,
    required this.tenantId,
    required this.agentChannel,
    required this.tokenAmount,
    required this.payLinkSentTo,
    required this.expiresAt,
  });

  /// The link's state for display. Paid when confirmed; expired when the hold
  /// lapsed or the window passed; otherwise sent.
  LinkStatus linkStatus({DateTime? now}) {
    final at = now ?? DateTime.now();
    if (status == 'CONFIRMED') return LinkStatus.paid;
    if (status == 'EXPIRED' || (expiresAt != null && at.isAfter(expiresAt!))) return LinkStatus.expired;
    return LinkStatus.sent;
  }

  factory AssistedBookingResult.fromJson(Map<String, dynamic> json) => AssistedBookingResult(
        bookingId: json['bookingId'] as String,
        status: json['status'] as String,
        tenantId: json['tenantId'] as String,
        agentChannel: json['agentChannel'] as String,
        tokenAmount: Paise((json['tokenAmountPaise'] as num).toInt()),
        payLinkSentTo: json['payLinkSentTo'] as String,
        expiresAt: json['expiresAt'] == null ? null : DateTime.parse(json['expiresAt'] as String),
      );
}

/// The Razorpay order the USER scans on their OWN device (walk-in). The agent only
/// displays it as a QR — there is no in-app pay action anywhere on the agent side.
class RazorpayOrder {
  final String orderId;
  final int amountPaise;
  final String currency;
  final String keyId;

  const RazorpayOrder({
    required this.orderId,
    required this.amountPaise,
    required this.currency,
    required this.keyId,
  });

  factory RazorpayOrder.fromJson(Map<String, dynamic> json) => RazorpayOrder(
        orderId: json['orderId'] as String,
        amountPaise: (json['amount'] as num).toInt(),
        currency: json['currency'] as String,
        keyId: json['keyId'] as String,
      );
}

/// Result of POST /v1/agent/walkin-bookings. The user scans [razorpayOrder] as a
/// QR on their own phone; confirmation is via the verified webhook ONLY. The agent
/// never pays.
class WalkInBookingResult {
  final String bookingId;
  final String status;
  final String tenantId;
  final String agentChannel; // WALK_IN
  final Paise tokenAmount;
  final RazorpayOrder razorpayOrder;
  final DateTime? expiresAt;

  const WalkInBookingResult({
    required this.bookingId,
    required this.status,
    required this.tenantId,
    required this.agentChannel,
    required this.tokenAmount,
    required this.razorpayOrder,
    required this.expiresAt,
  });

  /// The user-facing pay URL to encode into the QR. Mirrors the backend's
  /// `buildPayUrl` (bookingId + order) so a scanned link opens the hosted checkout
  /// for exactly this order. NOT an agent-side pay action — the agent only shows it.
  String get payUrl =>
      '${Env.payBaseUrl}/pay/$bookingId?order=${Uri.encodeComponent(razorpayOrder.orderId)}';

  factory WalkInBookingResult.fromJson(Map<String, dynamic> json) => WalkInBookingResult(
        bookingId: json['bookingId'] as String,
        status: json['status'] as String,
        tenantId: json['tenantId'] as String,
        agentChannel: json['agentChannel'] as String,
        tokenAmount: Paise((json['tokenAmountPaise'] as num).toInt()),
        razorpayOrder: RazorpayOrder.fromJson(json['razorpayOrder'] as Map<String, dynamic>),
        expiresAt: json['expiresAt'] == null ? null : DateTime.parse(json['expiresAt'] as String),
      );
}

/// Server-truth status of a walk-in booking as the agent can observe it. Derived
/// from GET /v1/agent/bookings/:id — the SPECIFIC booking's own status — so
/// "confirmed" reflects that booking's verified-webhook settlement, never an
/// aggregate counter another in-scope confirmation would move, and never a client
/// callback.
enum WalkInServerStatus { pending, confirmed }
