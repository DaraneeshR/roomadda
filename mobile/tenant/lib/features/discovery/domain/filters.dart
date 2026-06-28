/// Immutable discovery filter set. Mirrors the server's `listFiltersSchema`
/// (@roomadda/shared) — only the filters the P1.2 browse endpoint actually
/// supports are modelled here. (There is intentionally no `verifiedOnly`: the
/// public contract exposes no verified/trust signal, so a verified-only filter
/// can't be honoured server-side — see the feature notes.)
class ListingFilters {
  final String? city;
  final String? area;
  final String? gender; // MALE / FEMALE / COED
  final int? sharingType; // 1 = single, 2 = double, 3 = triple
  final int? minRentPaise;
  final int? maxRentPaise;
  final DateTime? moveInDate;
  final List<String> amenities;

  const ListingFilters({
    this.city,
    this.area,
    this.gender,
    this.sharingType,
    this.minRentPaise,
    this.maxRentPaise,
    this.moveInDate,
    this.amenities = const [],
  });

  ListingFilters copyWith({
    String? city,
    String? area,
    Object? gender = _unset,
    Object? sharingType = _unset,
    Object? minRentPaise = _unset,
    Object? maxRentPaise = _unset,
    Object? moveInDate = _unset,
    List<String>? amenities,
  }) {
    return ListingFilters(
      city: city ?? this.city,
      area: area ?? this.area,
      gender: gender == _unset ? this.gender : gender as String?,
      sharingType: sharingType == _unset ? this.sharingType : sharingType as int?,
      minRentPaise: minRentPaise == _unset ? this.minRentPaise : minRentPaise as int?,
      maxRentPaise: maxRentPaise == _unset ? this.maxRentPaise : maxRentPaise as int?,
      moveInDate: moveInDate == _unset ? this.moveInDate : moveInDate as DateTime?,
      amenities: amenities ?? this.amenities,
    );
  }

  /// Query params for `GET /v1/listings`. Only set keys are emitted, so the API
  /// never receives empty filters. `amenities` is the CSV the server expects.
  Map<String, String> toQuery() {
    final q = <String, String>{};
    if (city != null && city!.isNotEmpty) q['city'] = city!;
    if (area != null && area!.isNotEmpty) q['area'] = area!;
    if (gender != null) q['gender'] = gender!;
    if (sharingType != null) q['sharingType'] = '$sharingType';
    if (minRentPaise != null) q['minRentPaise'] = '$minRentPaise';
    if (maxRentPaise != null) q['maxRentPaise'] = '$maxRentPaise';
    if (moveInDate != null) q['moveInDate'] = _isoDate(moveInDate!);
    if (amenities.isNotEmpty) q['amenities'] = amenities.join(',');
    return q;
  }

  /// Count of active filter facets — drives the "Filters (N)" badge.
  int get activeCount {
    var n = 0;
    if (gender != null) n++;
    if (sharingType != null) n++;
    if (minRentPaise != null || maxRentPaise != null) n++;
    if (moveInDate != null) n++;
    if (amenities.isNotEmpty) n++;
    return n;
  }

  static const Object _unset = Object();
}

String _isoDate(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
