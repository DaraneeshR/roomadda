import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `HostListing` / `HostRoomInventory` contracts in `@roomadda/shared`.
/// This is the UNMASKED host view: the host owns the listing, so `actualName`,
/// `fullAddress` and exact geo are present (masking only applies to public/tenant
/// callers — see /CLAUDE.md domain rule #4). Money is integer paise via [Paise].
class HostListing {
  final String id;
  final String alias;
  final String actualName;
  final String areaLabel;
  final String city;
  final String pincode;
  final String fullAddress;
  final double lat;
  final double lng;
  final String gender; // MALE / FEMALE / COED
  final String status; // DRAFT / PENDING_REVIEW / PUBLISHED / SUSPENDED
  final bool paused;
  final bool instantBook;
  final List<String> amenities;
  final List<String> houseRules;
  final bool mealsOffered;
  final Paise? mealCharges;
  final Paise? tokenAmount;
  final Paise? priceFrom;
  final List<HostListingPhoto> photos;
  final List<HostRoomInventory> rooms;
  final DateTime createdAt;
  final DateTime updatedAt;

  const HostListing({
    required this.id,
    required this.alias,
    required this.actualName,
    required this.areaLabel,
    required this.city,
    required this.pincode,
    required this.fullAddress,
    required this.lat,
    required this.lng,
    required this.gender,
    required this.status,
    required this.paused,
    required this.instantBook,
    required this.amenities,
    required this.houseRules,
    required this.mealsOffered,
    required this.photos,
    required this.rooms,
    required this.createdAt,
    required this.updatedAt,
    this.mealCharges,
    this.tokenAmount,
    this.priceFrom,
  });

  bool get isLive => status == 'PUBLISHED' && !paused;
  bool get isPending => status == 'PENDING_REVIEW';
  bool get isDraft => status == 'DRAFT';

  /// True when any room is flagged "not verified in 3 days" (drives the dashboard nudge).
  bool get hasStaleInventory => rooms.any((r) => r.needsVerification);

  int get totalBeds => rooms.fold(0, (sum, r) => sum + r.totalBeds);
  int get availableBeds => rooms.fold(0, (sum, r) => sum + r.availableBeds);

  factory HostListing.fromJson(Map<String, dynamic> json) {
    final location = (json['location'] as Map<String, dynamic>?) ?? const {};
    return HostListing(
      id: json['id'] as String,
      alias: json['alias'] as String,
      actualName: json['actualName'] as String,
      areaLabel: json['areaLabel'] as String,
      city: json['city'] as String,
      pincode: json['pincode'] as String,
      fullAddress: json['fullAddress'] as String,
      lat: (location['lat'] as num?)?.toDouble() ?? 0,
      lng: (location['lng'] as num?)?.toDouble() ?? 0,
      gender: json['gender'] as String,
      status: json['status'] as String,
      paused: json['paused'] as bool,
      instantBook: json['instantBook'] as bool,
      amenities: (json['amenities'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
      houseRules: (json['houseRules'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
      mealsOffered: json['mealsOffered'] as bool,
      mealCharges: _paise(json['mealChargesPaise']),
      tokenAmount: _paise(json['tokenAmountPaise']),
      priceFrom: _paise(json['priceFromPaise']),
      photos: (json['photos'] as List<dynamic>? ?? const [])
          .map((e) => HostListingPhoto.fromJson(e as Map<String, dynamic>))
          .toList(),
      rooms: (json['rooms'] as List<dynamic>? ?? const [])
          .map((e) => HostRoomInventory.fromJson(e as Map<String, dynamic>))
          .toList(),
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

class HostListingPhoto {
  final String id;
  final String url;
  final bool isPrimary;
  final int sortOrder;

  const HostListingPhoto({
    required this.id,
    required this.url,
    required this.isPrimary,
    required this.sortOrder,
  });

  factory HostListingPhoto.fromJson(Map<String, dynamic> json) => HostListingPhoto(
        id: json['id'] as String,
        url: json['url'] as String,
        isPrimary: json['isPrimary'] as bool,
        sortOrder: json['sortOrder'] as int,
      );
}

/// Per-room occupancy rollup. Occupancy is split so a host-recorded walk-in
/// ([walkInBeds], a manual BLOCK) is distinct from a platform booking ([bookedBeds]).
class HostRoomInventory {
  final String roomId;
  final String name;
  final int? floor;
  final int sharingType;
  final Paise monthlyRent;
  final Paise deposit;
  final int totalBeds;
  final int bookedBeds;
  final int walkInBeds;
  final int heldBeds;
  final int availableBeds;
  final bool needsVerification;
  final DateTime? inventoryVerifiedAt;

  const HostRoomInventory({
    required this.roomId,
    required this.name,
    required this.floor,
    required this.sharingType,
    required this.monthlyRent,
    required this.deposit,
    required this.totalBeds,
    required this.bookedBeds,
    required this.walkInBeds,
    required this.heldBeds,
    required this.availableBeds,
    required this.needsVerification,
    required this.inventoryVerifiedAt,
  });

  /// Occupied = everything not free (booked + walk-in + held).
  int get occupiedBeds => bookedBeds + walkInBeds + heldBeds;

  factory HostRoomInventory.fromJson(Map<String, dynamic> json) => HostRoomInventory(
        roomId: json['roomId'] as String,
        name: json['name'] as String,
        floor: json['floor'] as int?,
        sharingType: json['sharingType'] as int,
        monthlyRent: Paise(json['monthlyRentPaise'] as int),
        deposit: Paise(json['depositPaise'] as int),
        totalBeds: json['totalBeds'] as int,
        bookedBeds: json['bookedBeds'] as int,
        walkInBeds: json['walkInBeds'] as int,
        heldBeds: json['heldBeds'] as int,
        availableBeds: json['availableBeds'] as int,
        needsVerification: json['needsVerification'] as bool,
        inventoryVerifiedAt: _date(json['inventoryVerifiedAt']),
      );
}

class HostListingPage {
  final List<HostListing> items;
  final String? nextCursor;

  const HostListingPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;
}

/// One entry in a listing's edit history.
class ListingEditLogItem {
  final String id;
  final List<String> fields;
  final bool requeued;
  final DateTime createdAt;

  const ListingEditLogItem({
    required this.id,
    required this.fields,
    required this.requeued,
    required this.createdAt,
  });

  factory ListingEditLogItem.fromJson(Map<String, dynamic> json) => ListingEditLogItem(
        id: json['id'] as String,
        fields: (json['fields'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
        requeued: json['requeued'] as bool,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

Paise? _paise(dynamic v) => v == null ? null : Paise(v as int);
DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String);

/// Selectable gender policies (mirrors the backend enum).
const genderPolicies = <String>['MALE', 'FEMALE', 'COED'];

String genderLabel(String g) => switch (g) {
      'MALE' => 'Boys',
      'FEMALE' => 'Girls',
      'COED' => 'Co-ed',
      _ => g,
    };

String listingStatusLabel(String status) => switch (status) {
      'DRAFT' => 'Draft',
      'PENDING_REVIEW' => 'In review',
      'PUBLISHED' => 'Live',
      'SUSPENDED' => 'Suspended',
      _ => status,
    };
