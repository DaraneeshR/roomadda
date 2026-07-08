import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/domain/listing.dart';

/// The B2C hotel domain, mirroring the `@roomadda/shared` contracts. Money is the
/// SERVER-OWNED integer-paise snapshot read straight off the DTO — this layer NEVER
/// computes `perNightPaise × nights` (see /CLAUDE.md money rule #1). The listing is
/// the same MASKED public shape as PG discovery ([PublicListing]) so pre-booking
/// masking holds identically; the reservation's `qrCodeToken` and unmasked details
/// arrive ONLY once the verified webhook has CONFIRMED it (rule #2).

/// One bookable room tier priced + counted for the searched date range. `total`
/// is the server's `totalPaise` (perNightPaise × nights, computed server-side),
/// exposed as [total] so it is READ, never re-derived here.
class HotelCategory {
  final String categoryId;
  final String tier;

  /// Base nightly rate — server-owned snapshot.
  final Paise perNight;

  /// Nights in the searched range (server-computed; a day count, never a price).
  final int nights;

  /// perNightPaise × nights, computed server-side. Read straight from the DTO.
  final Paise total;

  /// REAL count of B2C rooms free for the whole range (corporate rooms excluded).
  final int availableRooms;

  final List<String> photos;
  final List<String> amenities;

  const HotelCategory({
    required this.categoryId,
    required this.tier,
    required this.perNight,
    required this.nights,
    required this.total,
    required this.availableRooms,
    required this.photos,
    required this.amenities,
  });

  /// Bookable only when it has a nightly price AND at least one free B2C room.
  bool get isBookable => availableRooms > 0 && perNight.value > 0;

  factory HotelCategory.fromJson(Map<String, dynamic> j) => HotelCategory(
        categoryId: j['categoryId'] as String,
        tier: j['tier'] as String,
        perNight: Paise((j['perNightPaise'] as num).toInt()),
        nights: (j['nights'] as num).toInt(),
        total: Paise((j['totalPaise'] as num).toInt()),
        availableRooms: (j['availableRooms'] as num).toInt(),
        photos: (j['photos'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
        amenities: (j['amenities'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
      );
}

/// A masked hotel listing plus its bookable categories for the searched range.
class HotelSearchResult {
  /// The MASKED public listing (alias + area only — reuses the discovery model so
  /// masking is enforced identically; a HOTEL has no PG `rooms`, so that list is
  /// empty and categories drive pricing instead).
  final PublicListing listing;
  final List<HotelCategory> categories;

  const HotelSearchResult({required this.listing, required this.categories});

  /// Cheapest nightly rate across categories — a read of server prices, not math.
  Paise? get fromPerNight {
    if (categories.isEmpty) return null;
    var min = categories.first.perNight.value;
    for (final c in categories) {
      if (c.perNight.value < min) min = c.perNight.value;
    }
    return Paise(min);
  }

  /// Total free B2C rooms across all bookable categories for the searched dates.
  int get freeRooms =>
      categories.fold(0, (sum, c) => sum + (c.availableRooms > 0 ? c.availableRooms : 0));

  factory HotelSearchResult.fromJson(Map<String, dynamic> j) => HotelSearchResult(
        listing: PublicListing.fromJson(j['listing'] as Map<String, dynamic>),
        categories: (j['categories'] as List<dynamic>? ?? const [])
            .map((e) => HotelCategory.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// One page of the availability search, echoing the resolved stay window. Dates
/// are the server's `yyyy-mm-dd` strings; `nights`/`guests` are server-resolved.
class HotelSearchResponse {
  final List<HotelSearchResult> items;
  final String? nextCursor;
  final String checkIn;
  final String checkOut;
  final int nights;
  final int guests;

  const HotelSearchResponse({
    required this.items,
    required this.nextCursor,
    required this.checkIn,
    required this.checkOut,
    required this.nights,
    required this.guests,
  });

  factory HotelSearchResponse.fromJson(Map<String, dynamic> j) => HotelSearchResponse(
        items: (j['items'] as List<dynamic>? ?? const [])
            .map((e) => HotelSearchResult.fromJson(e as Map<String, dynamic>))
            .toList(),
        nextCursor: j['nextCursor'] as String?,
        checkIn: j['checkIn'] as String,
        checkOut: j['checkOut'] as String,
        nights: (j['nights'] as num).toInt(),
        guests: (j['guests'] as num).toInt(),
      );
}

/// A guest's nightly reservation. Status + `qrCodeToken` are SERVER-OWNED: the app
/// only reads them and NEVER decides CONFIRMED itself. `qrCodeToken` is null until
/// the verified webhook mints it (see /CLAUDE.md money rule #2).
class HotelReservation {
  final String id;
  final String listingId;
  final String categoryId;
  final String status; // HELD / CONFIRMED / CANCELLED / EXPIRED
  final DateTime checkIn;
  final DateTime checkOut;
  final int nights;
  final Paise perNight;

  /// perNightPaise × nights, snapshot at hold time (server-owned). Read, never computed.
  final Paise roomTotal;

  /// Amount due now to confirm the hold (full-stay prepay, so == [roomTotal]). Server-owned.
  final Paise tokenAmount;

  final DateTime? holdExpiresAt;
  final DateTime? confirmedAt;

  /// Opaque check-in code, present ONLY once CONFIRMED. Use [checkInCode].
  final String? qrCodeToken;

  final DateTime createdAt;

  const HotelReservation({
    required this.id,
    required this.listingId,
    required this.categoryId,
    required this.status,
    required this.checkIn,
    required this.checkOut,
    required this.nights,
    required this.perNight,
    required this.roomTotal,
    required this.tokenAmount,
    required this.createdAt,
    this.holdExpiresAt,
    this.confirmedAt,
    this.qrCodeToken,
  });

  bool get isConfirmed => status == 'CONFIRMED';

  /// Terminal non-success: the hold lapsed (EXPIRED) or it was CANCELLED.
  bool get isEnded => status == 'EXPIRED' || status == 'CANCELLED';

  /// Awaiting its securing payment.
  bool get isHeld => status == 'HELD';

  /// The check-in QR token, or null while unconfirmed. Mirrors the backend: the
  /// token exists ONLY on a webhook-confirmed reservation, so the app can never
  /// fabricate a check-in code from a masked/held snapshot.
  String? get checkInCode => isConfirmed ? qrCodeToken : null;

  factory HotelReservation.fromJson(Map<String, dynamic> j) => HotelReservation(
        id: j['id'] as String,
        listingId: j['listingId'] as String,
        categoryId: j['categoryId'] as String,
        status: j['status'] as String,
        checkIn: DateTime.parse(j['checkIn'] as String),
        checkOut: DateTime.parse(j['checkOut'] as String),
        nights: (j['nights'] as num).toInt(),
        perNight: Paise((j['perNightPaise'] as num).toInt()),
        roomTotal: Paise((j['roomTotalPaise'] as num).toInt()),
        tokenAmount: Paise((j['tokenAmountPaise'] as num).toInt()),
        holdExpiresAt: _parseDate(j['holdExpiresAt']),
        confirmedAt: _parseDate(j['confirmedAt']),
        qrCodeToken: j['qrCodeToken'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

/// The server-owned Razorpay order for a reservation's securing payment.
class HotelRazorpayOrder {
  final String orderId;
  final int amountPaise;
  final String currency;
  final String keyId;

  const HotelRazorpayOrder({
    required this.orderId,
    required this.amountPaise,
    required this.currency,
    required this.keyId,
  });

  /// True only for a reachable live/test gateway. A local stub order
  /// (`order_stub_…` / a non-`rzp_` key) can't open the SDK, so the flow drops
  /// straight into the confirmation poll — mirrors the web `isRealCheckout`.
  bool get isRealCheckout => keyId.startsWith('rzp_') && !orderId.startsWith('order_stub');

  factory HotelRazorpayOrder.fromJson(Map<String, dynamic> j) => HotelRazorpayOrder(
        orderId: j['orderId'] as String,
        amountPaise: (j['amount'] as num).toInt(),
        currency: j['currency'] as String,
        keyId: j['keyId'] as String,
      );
}

/// Response of POST /v1/hotels/reservations/:id/payment.
class HotelPaymentOrder {
  final String reservationId;
  final Paise amount;
  final HotelRazorpayOrder? razorpayOrder;

  const HotelPaymentOrder({required this.reservationId, required this.amount, this.razorpayOrder});

  factory HotelPaymentOrder.fromJson(Map<String, dynamic> j) => HotelPaymentOrder(
        reservationId: j['reservationId'] as String,
        amount: Paise((j['amountPaise'] as num).toInt()),
        razorpayOrder: j['razorpayOrder'] == null
            ? null
            : HotelRazorpayOrder.fromJson(j['razorpayOrder'] as Map<String, dynamic>),
      );
}

/// Outcome of a cancellation: the new status + the refund the policy awarded. The
/// refund settles ONLY via the verified webhook, so `refundStatus` is PENDING/NONE.
class HotelCancelResult {
  final String status;
  final Paise refund;
  final String refundStatus;

  const HotelCancelResult({required this.status, required this.refund, required this.refundStatus});

  factory HotelCancelResult.fromJson(Map<String, dynamic> j) => HotelCancelResult(
        status: j['status'] as String,
        refund: Paise((j['refundPaise'] as num?)?.toInt() ?? 0),
        refundStatus: j['refundStatus'] as String? ?? 'NONE',
      );
}

DateTime? _parseDate(dynamic value) => value == null ? null : DateTime.parse(value as String);
