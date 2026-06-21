import '../../../core/money/paise.dart';

/// Mirrors the `BookingDetail` contract in `@roomadda/shared`. Status and the
/// confirmation/payment fields are SERVER-OWNED: the app only ever reads them
/// and never decides CONFIRMED itself (see /CLAUDE.md: payment truth = the
/// verified webhook). `confirmedAt` / `payment` are null until the webhook
/// settles the token.
///
/// The lighter `POST /v1/bookings` (create-hold) response omits the nested
/// fields, so they parse as null — only `GET /v1/bookings/:id` carries them.
class Booking {
  final String id;
  final String status; // TOKEN_PENDING / CONFIRMED / EXPIRED / CANCELLED / ...
  final Paise tokenAmount;
  final DateTime? confirmedAt;
  final DateTime? holdExpiresAt;
  final PaymentSummary? payment;

  const Booking({
    required this.id,
    required this.status,
    required this.tokenAmount,
    this.confirmedAt,
    this.holdExpiresAt,
    this.payment,
  });

  bool get isConfirmed => status == 'CONFIRMED';

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        id: json['id'] as String,
        status: json['status'] as String,
        tokenAmount: Paise(json['tokenAmountPaise'] as int),
        confirmedAt: _parseDate(json['confirmedAt']),
        holdExpiresAt: _parseDate(json['holdExpiresAt']),
        payment: json['payment'] == null
            ? null
            : PaymentSummary.fromJson(json['payment'] as Map<String, dynamic>),
      );
}

/// Per-leg payment summary the payment screen polls. `online` / `cash` are null
/// when that leg is absent.
class PaymentSummary {
  final String method; // RAZORPAY / CASH / SPLIT
  final String status; // CREATED / AUTHORIZED / CAPTURED / FAILED / REFUNDED
  final OnlinePaymentLeg? online;
  final CashPaymentLeg? cash;

  const PaymentSummary({required this.method, required this.status, this.online, this.cash});

  factory PaymentSummary.fromJson(Map<String, dynamic> json) => PaymentSummary(
        method: json['method'] as String,
        status: json['status'] as String,
        online: json['online'] == null
            ? null
            : OnlinePaymentLeg.fromJson(json['online'] as Map<String, dynamic>),
        cash: json['cash'] == null
            ? null
            : CashPaymentLeg.fromJson(json['cash'] as Map<String, dynamic>),
      );
}

class OnlinePaymentLeg {
  final String status;
  /// Set by the verified `payment.captured` webhook; null until captured.
  final DateTime? capturedAt;

  const OnlinePaymentLeg({required this.status, this.capturedAt});

  factory OnlinePaymentLeg.fromJson(Map<String, dynamic> json) => OnlinePaymentLeg(
        status: json['status'] as String,
        capturedAt: _parseDate(json['capturedAt']),
      );
}

class CashPaymentLeg {
  final String status;

  const CashPaymentLeg({required this.status});

  factory CashPaymentLeg.fromJson(Map<String, dynamic> json) =>
      CashPaymentLeg(status: json['status'] as String);
}

DateTime? _parseDate(dynamic value) => value == null ? null : DateTime.parse(value as String);

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
