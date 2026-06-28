import 'package:roomadda_core/roomadda_core.dart';

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
  final String bedId;
  final String listingId;
  final String status; // PENDING_APPROVAL / TOKEN_PENDING / CONFIRMED / EXPIRED / ...
  final Paise tokenAmount;
  final Paise? monthlyRent;
  final Paise? deposit;
  final DateTime createdAt;
  final DateTime? moveInDate;
  final String? mealPlan;
  /// Host's name — present ONLY once the booking is CONFIRMED (server-owned).
  final String? hostName;
  final DateTime? confirmedAt;
  final DateTime? holdExpiresAt;
  final PaymentSummary? payment;

  /// The attached listing. Null on the lightweight create-hold response; present
  /// on `GET /v1/bookings/:id` and `GET /v1/bookings`. Masked until the booking
  /// is CONFIRMED (see [BookingListing]).
  final BookingListing? listing;

  const Booking({
    required this.id,
    required this.bedId,
    required this.listingId,
    required this.status,
    required this.tokenAmount,
    required this.createdAt,
    this.monthlyRent,
    this.deposit,
    this.moveInDate,
    this.mealPlan,
    this.hostName,
    this.confirmedAt,
    this.holdExpiresAt,
    this.payment,
    this.listing,
  });

  bool get isConfirmed => status == 'CONFIRMED';
  bool get isExpired => status == 'EXPIRED';
  bool get isPendingApproval => status == 'PENDING_APPROVAL';
  bool get isTokenPending => status == 'TOKEN_PENDING';

  /// True once the server has recorded the (online) payment leg as FAILED.
  bool get isPaymentFailed =>
      payment != null && (payment!.status == 'FAILED' || payment!.online?.status == 'FAILED');

  factory Booking.fromJson(Map<String, dynamic> json) => Booking(
        id: json['id'] as String,
        bedId: json['bedId'] as String,
        listingId: json['listingId'] as String,
        status: json['status'] as String,
        tokenAmount: Paise(json['tokenAmountPaise'] as int),
        monthlyRent: json['monthlyRentPaise'] == null ? null : Paise(json['monthlyRentPaise'] as int),
        deposit: json['depositPaise'] == null ? null : Paise(json['depositPaise'] as int),
        createdAt: DateTime.parse(json['createdAt'] as String),
        moveInDate: _parseDate(json['moveInDate']),
        mealPlan: json['mealPlan'] as String?,
        hostName: json['hostName'] as String?,
        confirmedAt: _parseDate(json['confirmedAt']),
        holdExpiresAt: _parseDate(json['holdExpiresAt']),
        payment: json['payment'] == null
            ? null
            : PaymentSummary.fromJson(json['payment'] as Map<String, dynamic>),
        listing: json['listing'] == null
            ? null
            : BookingListing.fromJson(json['listing'] as Map<String, dynamic>),
      );
}

/// A page of the tenant's own bookings (cursor-paginated, newest first).
class BookingPage {
  final List<Booking> items;
  final String? nextCursor;

  const BookingPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;
}

/// The listing attached to a booking. The server MASKS it until the booking is
/// CONFIRMED: while masked, `actualName` / `fullAddress` are absent (parsed as
/// null) and only `alias` / `areaLabel` are shown. The unmasked fields appear
/// ONLY because the server returns them post-CONFIRMED — the app never unmasks
/// (see /CLAUDE.md domain rule #4: masking is enforced server-side).
class BookingListing {
  final String id;
  final String alias;
  final String areaLabel;
  final String city;
  final bool masked;
  final String? actualName;
  final String? fullAddress;

  const BookingListing({
    required this.id,
    required this.alias,
    required this.areaLabel,
    required this.city,
    required this.masked,
    this.actualName,
    this.fullAddress,
  });

  /// What to show as the place's name: the real name once unmasked, else alias.
  String get displayName => actualName ?? alias;

  factory BookingListing.fromJson(Map<String, dynamic> json) => BookingListing(
        id: json['id'] as String,
        alias: json['alias'] as String,
        areaLabel: json['areaLabel'] as String,
        city: json['city'] as String,
        masked: json['masked'] as bool,
        actualName: json['actualName'] as String?,
        fullAddress: json['fullAddress'] as String?,
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
