import 'package:roomadda_core/roomadda_core.dart';

/// A coarse, masked geo point (~1 km precision) — the only location the public
/// API exposes pre-booking. The exact address/geo is server-side masked.
class GeoPoint {
  final double lat;
  final double lng;
  const GeoPoint(this.lat, this.lng);
}

class ListingPhoto {
  final String id;
  final String url;
  final bool isPrimary;
  final int sortOrder;

  const ListingPhoto({required this.id, required this.url, required this.isPrimary, required this.sortOrder});

  factory ListingPhoto.fromJson(Map<String, dynamic> j) => ListingPhoto(
        id: j['id'] as String,
        url: j['url'] as String,
        isPrimary: j['isPrimary'] as bool? ?? false,
        sortOrder: (j['sortOrder'] as num?)?.toInt() ?? 0,
      );
}

class ListingRoom {
  final String id;
  final String name;
  final int? floor;
  final int sharingType;
  final Paise monthlyRent;
  final Paise deposit;
  final int totalBeds;
  final int availableBeds;

  const ListingRoom({
    required this.id,
    required this.name,
    required this.floor,
    required this.sharingType,
    required this.monthlyRent,
    required this.deposit,
    required this.totalBeds,
    required this.availableBeds,
  });

  bool get hasAvailability => availableBeds > 0;

  factory ListingRoom.fromJson(Map<String, dynamic> j) => ListingRoom(
        id: j['id'] as String,
        name: j['name'] as String,
        floor: (j['floor'] as num?)?.toInt(),
        sharingType: (j['sharingType'] as num).toInt(),
        monthlyRent: Paise((j['monthlyRentPaise'] as num).toInt()),
        deposit: Paise((j['depositPaise'] as num).toInt()),
        totalBeds: (j['totalBeds'] as num).toInt(),
        availableBeds: (j['availableBeds'] as num).toInt(),
      );
}

/// A MASKED public listing. Only the fields the masked API returns exist on this
/// model — there is deliberately NO `actualName`, `fullAddress`, `pincode` or
/// exact geo, so they can NEVER be rendered pre-booking (see /CLAUDE.md domain
/// rule #4: masking is enforced server-side; the client renders only what it got).
class PublicListing {
  final String id;
  final String alias;
  final String areaLabel;
  final String city;
  final String gender; // MALE / FEMALE / COED
  final String status;
  final List<String> amenities;
  final Paise? priceFrom;
  /// Instant Book confirms on payment; otherwise booking waits for host accept.
  final bool instantBook;
  final List<ListingPhoto> photos;
  final List<ListingRoom> rooms;
  final GeoPoint approxLocation;
  final bool masked;

  /// Distance from the searched point, in metres. Present ONLY on nearby results.
  final int? distanceMeters;

  const PublicListing({
    required this.id,
    required this.alias,
    required this.areaLabel,
    required this.city,
    required this.gender,
    required this.status,
    required this.amenities,
    required this.priceFrom,
    required this.instantBook,
    required this.photos,
    required this.rooms,
    required this.approxLocation,
    required this.masked,
    this.distanceMeters,
  });

  ListingPhoto? get coverPhoto {
    if (photos.isEmpty) return null;
    for (final p in photos) {
      if (p.isPrimary) return p;
    }
    return photos.first;
  }

  bool get hasAvailability => rooms.any((r) => r.hasAvailability);

  /// Lowest room rent, falling back to the server's `priceFromPaise`.
  Paise? get startingRent => priceFrom;

  factory PublicListing.fromJson(Map<String, dynamic> j) => PublicListing(
        id: j['id'] as String,
        alias: j['alias'] as String,
        areaLabel: j['areaLabel'] as String,
        city: j['city'] as String,
        gender: j['gender'] as String,
        status: j['status'] as String,
        amenities: (j['amenities'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
        priceFrom: j['priceFromPaise'] == null ? null : Paise((j['priceFromPaise'] as num).toInt()),
        instantBook: j['instantBook'] as bool? ?? true,
        photos: (j['photos'] as List<dynamic>? ?? const [])
            .map((e) => ListingPhoto.fromJson(e as Map<String, dynamic>))
            .toList(),
        rooms: (j['rooms'] as List<dynamic>? ?? const [])
            .map((e) => ListingRoom.fromJson(e as Map<String, dynamic>))
            .toList(),
        approxLocation: _geo(j['approxLocation']),
        masked: j['masked'] as bool? ?? true,
        distanceMeters: (j['distanceMeters'] as num?)?.toInt(),
      );
}

GeoPoint _geo(dynamic v) {
  if (v is Map) {
    return GeoPoint((v['lat'] as num).toDouble(), (v['lng'] as num).toDouble());
  }
  return const GeoPoint(0, 0);
}

/// A page of masked listings (cursor-paginated, newest first).
class ListingsPage {
  final List<PublicListing> items;
  final String? nextCursor;
  const ListingsPage({required this.items, this.nextCursor});
}
