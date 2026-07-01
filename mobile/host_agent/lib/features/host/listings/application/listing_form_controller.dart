import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/host_listing_repository.dart';
import '../domain/edit_classify.dart';
import '../domain/host_listing.dart';

/// One photo in the form: either already attached to the listing (remote [url],
/// e.g. an existing photo in edit mode) or a freshly-picked on-device image
/// ([bytes]) pending upload. The min-5 gate counts both; on submit each local
/// photo is uploaded to a presigned URL and attached, then becomes remote.
class ListingPhotoDraft {
  final String? url;
  final Uint8List? bytes;
  final String contentType;

  const ListingPhotoDraft.remote(String this.url)
      : bytes = null,
        contentType = 'image/jpeg';

  const ListingPhotoDraft.local(Uint8List this.bytes, this.contentType) : url = null;

  /// True once the photo has a server URL (existing, or just uploaded + attached).
  bool get isUploaded => url != null;
}

/// One room being created or edited. In create mode [roomId] is null and [bedCount]
/// drives how many beds to attach; in edit mode [roomId] is the existing room and
/// [originalRentPaise] is its pre-edit rent (so the form can predict a >20% re-queue).
class RoomDraft {
  final String? roomId;
  final String name;
  final int? floor;
  final int sharingType;
  final int monthlyRentPaise;
  final int depositPaise;
  final int bedCount;
  final int? originalRentPaise;

  const RoomDraft({
    this.roomId,
    this.name = '',
    this.floor,
    this.sharingType = 1,
    this.monthlyRentPaise = 0,
    this.depositPaise = 0,
    this.bedCount = 1,
    this.originalRentPaise,
  });

  bool get isValid => name.trim().isNotEmpty && sharingType >= 1 && monthlyRentPaise > 0 && bedCount >= 1;

  /// In edit mode, a >20% rent move on an existing room re-queues the listing.
  bool get rentRequeues =>
      roomId != null && originalRentPaise != null && isRentChangeSignificant(originalRentPaise!, monthlyRentPaise);

  RoomDraft copyWith({
    String? name,
    Object? floor = _unset,
    int? sharingType,
    int? monthlyRentPaise,
    int? depositPaise,
    int? bedCount,
  }) =>
      RoomDraft(
        roomId: roomId,
        name: name ?? this.name,
        floor: identical(floor, _unset) ? this.floor : floor as int?,
        sharingType: sharingType ?? this.sharingType,
        monthlyRentPaise: monthlyRentPaise ?? this.monthlyRentPaise,
        depositPaise: depositPaise ?? this.depositPaise,
        bedCount: bedCount ?? this.bedCount,
        originalRentPaise: originalRentPaise,
      );

  factory RoomDraft.fromRoom(HostRoomInventory r) => RoomDraft(
        roomId: r.roomId,
        name: r.name,
        floor: r.floor,
        sharingType: r.sharingType,
        monthlyRentPaise: r.monthlyRent.value,
        depositPaise: r.deposit.value,
        bedCount: r.totalBeds,
        originalRentPaise: r.monthlyRent.value,
      );
}

/// Minimum photos required to publish a listing (the §9.2 go-live gate). The form
/// blocks submit/publish below this — validated client-side AND on the backend.
const minListingPhotos = 5;

class ListingFormState {
  // Step 1 — basics + map pin.
  final String alias;
  final String actualName;
  final String areaLabel;
  final String city;
  final String pincode;
  final String fullAddress;
  final double? lat;
  final double? lng;
  final String gender;
  // Step 2 — rooms / beds / pricing.
  final List<RoomDraft> rooms;
  // Step 3 — amenities.
  final List<String> amenities;
  // Step 4 — meals.
  final bool mealsOffered;
  final int? mealChargesPaise;
  // Step 5 — rules.
  final List<String> houseRules;
  // Step 6 — photos (on-device captures + any existing; min 5). Uploaded to a
  // presigned URL on submit (the listing-scoped endpoint needs the listing id).
  final List<ListingPhotoDraft> photos;
  // Step 7 — token + booking type.
  final int? tokenAmountPaise;
  final bool instantBook;
  // Meta.
  final bool submitting;
  final String? error;

  const ListingFormState({
    this.alias = '',
    this.actualName = '',
    this.areaLabel = '',
    this.city = '',
    this.pincode = '',
    this.fullAddress = '',
    this.lat,
    this.lng,
    this.gender = 'COED',
    this.rooms = const [],
    this.amenities = const [],
    this.mealsOffered = false,
    this.mealChargesPaise,
    this.houseRules = const [],
    this.photos = const [],
    this.tokenAmountPaise,
    this.instantBook = true,
    this.submitting = false,
    this.error,
  });

  // --- Per-step validity ----------------------------------------------------
  bool get basicsValid =>
      alias.trim().isNotEmpty &&
      actualName.trim().isNotEmpty &&
      areaLabel.trim().isNotEmpty &&
      city.trim().isNotEmpty &&
      RegExp(r'^\d{6}$').hasMatch(pincode) &&
      fullAddress.trim().isNotEmpty &&
      lat != null &&
      lng != null;

  bool get roomsValid => rooms.isNotEmpty && rooms.every((r) => r.isValid);

  /// The min-5-photos gate. The form cannot be submitted/published below it.
  bool get photosValid => photos.length >= minListingPhotos;

  bool get mealsValid => !mealsOffered || (mealChargesPaise != null && mealChargesPaise! >= 0);

  bool get tokenValid => tokenAmountPaise != null && tokenAmountPaise! > 0;

  /// Everything required to create a publishable listing.
  bool get canSubmit =>
      basicsValid && roomsValid && photosValid && mealsValid && tokenValid && !submitting;

  ListingFormState copyWith({
    String? alias,
    String? actualName,
    String? areaLabel,
    String? city,
    String? pincode,
    String? fullAddress,
    Object? lat = _unset,
    Object? lng = _unset,
    String? gender,
    List<RoomDraft>? rooms,
    List<String>? amenities,
    bool? mealsOffered,
    Object? mealChargesPaise = _unset,
    List<String>? houseRules,
    List<ListingPhotoDraft>? photos,
    Object? tokenAmountPaise = _unset,
    bool? instantBook,
    bool? submitting,
    Object? error = _unset,
  }) =>
      ListingFormState(
        alias: alias ?? this.alias,
        actualName: actualName ?? this.actualName,
        areaLabel: areaLabel ?? this.areaLabel,
        city: city ?? this.city,
        pincode: pincode ?? this.pincode,
        fullAddress: fullAddress ?? this.fullAddress,
        lat: identical(lat, _unset) ? this.lat : lat as double?,
        lng: identical(lng, _unset) ? this.lng : lng as double?,
        gender: gender ?? this.gender,
        rooms: rooms ?? this.rooms,
        amenities: amenities ?? this.amenities,
        mealsOffered: mealsOffered ?? this.mealsOffered,
        mealChargesPaise:
            identical(mealChargesPaise, _unset) ? this.mealChargesPaise : mealChargesPaise as int?,
        houseRules: houseRules ?? this.houseRules,
        photos: photos ?? this.photos,
        tokenAmountPaise:
            identical(tokenAmountPaise, _unset) ? this.tokenAmountPaise : tokenAmountPaise as int?,
        instantBook: instantBook ?? this.instantBook,
        submitting: submitting ?? this.submitting,
        error: identical(error, _unset) ? this.error : error as String?,
      );

  factory ListingFormState.fromListing(HostListing l) => ListingFormState(
        alias: l.alias,
        actualName: l.actualName,
        areaLabel: l.areaLabel,
        city: l.city,
        pincode: l.pincode,
        fullAddress: l.fullAddress,
        lat: l.lat,
        lng: l.lng,
        gender: l.gender,
        rooms: l.rooms.map(RoomDraft.fromRoom).toList(),
        amenities: List.of(l.amenities),
        mealsOffered: l.mealsOffered,
        mealChargesPaise: l.mealCharges?.value,
        houseRules: List.of(l.houseRules),
        photos: l.photos.map((p) => ListingPhotoDraft.remote(p.url)).toList(),
        tokenAmountPaise: l.tokenAmount?.value,
        instantBook: l.instantBook,
      );
}

const _unset = Object();

/// Drives the 7-step create/edit form. In CREATE mode it orchestrates the build
/// (listing → rooms → beds → photos); in EDIT mode it diffs against [original],
/// PATCHes the changed listing/room fields and POSTs newly-added photos. The
/// server returns the authoritative re-queue verdict; [editWouldRequeue] only
/// predicts it for a pre-save warning.
class ListingFormController extends StateNotifier<ListingFormState> {
  ListingFormController(this._repo, {HostListing? original})
      : _original = original,
        super(original == null ? const ListingFormState() : ListingFormState.fromListing(original));

  final HostListingRepository _repo;
  final HostListing? _original;

  /// In create mode, the listing once its draft has been created — so a retry
  /// after a mid-upload failure resumes against the same draft (never duplicates
  /// the listing/rooms/beds).
  String? _createdListingId;

  bool get isEdit => _original != null;

  // --- Field setters --------------------------------------------------------
  void setAlias(String v) => state = state.copyWith(alias: v);
  void setActualName(String v) => state = state.copyWith(actualName: v);
  void setAreaLabel(String v) => state = state.copyWith(areaLabel: v);
  void setCity(String v) => state = state.copyWith(city: v);
  void setPincode(String v) => state = state.copyWith(pincode: v);
  void setFullAddress(String v) => state = state.copyWith(fullAddress: v);
  void setPin(double lat, double lng) => state = state.copyWith(lat: lat, lng: lng);
  void setGender(String v) => state = state.copyWith(gender: v);
  void setMealsOffered(bool v) => state = state.copyWith(mealsOffered: v);
  void setMealCharges(int? paise) => state = state.copyWith(mealChargesPaise: paise);
  void setToken(int? paise) => state = state.copyWith(tokenAmountPaise: paise);
  void setInstantBook(bool v) => state = state.copyWith(instantBook: v);

  void addRoom() => state = state.copyWith(rooms: [...state.rooms, const RoomDraft()]);
  void removeRoom(int i) =>
      state = state.copyWith(rooms: [...state.rooms]..removeAt(i));
  void updateRoom(int i, RoomDraft room) {
    final next = [...state.rooms];
    next[i] = room;
    state = state.copyWith(rooms: next);
  }

  void toggleAmenity(String a) {
    final next = [...state.amenities];
    next.contains(a) ? next.remove(a) : next.add(a);
    state = state.copyWith(amenities: next);
  }

  void setHouseRules(List<String> rules) => state = state.copyWith(houseRules: rules);

  /// Add one on-device photo (bytes held until submit, where it's uploaded to a
  /// presigned URL and attached). The min-5 gate counts it immediately.
  void addLocalPhoto(Uint8List bytes, String contentType) =>
      state = state.copyWith(photos: [...state.photos, ListingPhotoDraft.local(bytes, contentType)]);

  void removePhoto(int i) => state = state.copyWith(photos: [...state.photos]..removeAt(i));

  /// PREDICT whether saving the current edits will re-queue the listing (an
  /// address change, or a >20% room-rent move). Edit mode only; the backend
  /// remains the source of truth on actual save.
  bool get editWouldRequeue {
    final original = _original;
    if (original == null) return false;
    final addressChanged = state.fullAddress != original.fullAddress ||
        state.pincode != original.pincode ||
        state.lat != original.lat ||
        state.lng != original.lng;
    final rentRequeues = state.rooms.any((r) => r.rentRequeues);
    return addressChanged || rentRequeues;
  }

  /// CREATE: build the listing end-to-end and return its new id. Does not publish
  /// — the detail screen offers Publish once it's a DRAFT. Photos are uploaded to
  /// presigned URLs here (the listing-scoped endpoint needs the id), so a retry
  /// after a partial failure reuses the draft + skips already-attached photos.
  Future<String?> submitCreate() async {
    if (!state.canSubmit) return null;
    state = state.copyWith(submitting: true, error: null);
    try {
      var id = _createdListingId;
      if (id == null) {
        id = await _repo.createListing({
          'alias': state.alias.trim(),
          'actualName': state.actualName.trim(),
          'areaLabel': state.areaLabel.trim(),
          'city': state.city.trim(),
          'pincode': state.pincode,
          'fullAddress': state.fullAddress.trim(),
          'latitude': state.lat,
          'longitude': state.lng,
          'gender': state.gender,
          'amenities': state.amenities,
          'houseRules': state.houseRules,
          'mealsOffered': state.mealsOffered,
          if (state.mealsOffered && state.mealChargesPaise != null) 'mealChargesPaise': state.mealChargesPaise,
          if (state.tokenAmountPaise != null) 'tokenAmountPaise': state.tokenAmountPaise,
          'instantBook': state.instantBook,
        });

        for (final room in state.rooms) {
          final roomId = await _repo.addRoom(id, {
            'name': room.name.trim(),
            if (room.floor != null) 'floor': room.floor,
            'sharingType': room.sharingType,
            'monthlyRentPaise': room.monthlyRentPaise,
            'depositPaise': room.depositPaise,
          });
          for (var b = 0; b < room.bedCount; b++) {
            await _repo.addBed(id, roomId, {'label': 'B${b + 1}'});
          }
        }
        _createdListingId = id;
      }

      // Upload + attach each photo (the first is the cover). On a retry the
      // already-attached photos are remote and skipped.
      await _attachPendingPhotos(id, primaryFirst: true);

      state = state.copyWith(submitting: false);
      return id;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiExceptionFrom(e).message);
      return null;
    }
  }

  /// Upload every not-yet-attached (local) photo to a presigned URL and attach it,
  /// flipping each to a remote draft as it lands so a retry never re-uploads it.
  /// `primaryFirst` marks the photo at index 0 as the cover (create only).
  Future<void> _attachPendingPhotos(String listingId, {required bool primaryFirst}) async {
    for (var i = 0; i < state.photos.length; i++) {
      final photo = state.photos[i];
      if (photo.isUploaded) continue;
      final target = await _repo.requestPhotoUploadUrl(listingId, photo.contentType);
      await _repo.uploadPhotoBytes(target.uploadUrl, photo.bytes!, photo.contentType);
      await _repo.addPhoto(listingId, {
        'url': target.publicUrl,
        'isPrimary': primaryFirst && i == 0,
        'sortOrder': i,
      });
      final next = [...state.photos];
      next[i] = ListingPhotoDraft.remote(target.publicUrl);
      state = state.copyWith(photos: next);
    }
  }

  /// EDIT: PATCH the changed listing fields, PATCH each changed existing room, and
  /// POST any newly-added photos. Returns whether the server re-queued the listing
  /// (true if any patch re-queued), or null on failure.
  Future<bool?> submitEdit() async {
    final original = _original;
    if (original == null || !state.canSubmit) return null;
    state = state.copyWith(submitting: true, error: null);
    try {
      var requeued = false;

      final listingPatch = _listingPatch(original);
      if (listingPatch.isNotEmpty) {
        final res = await _repo.updateListing(original.id, listingPatch);
        requeued = requeued || res.requeued;
      }

      for (final room in state.rooms.where((r) => r.roomId != null)) {
        final before = original.rooms.firstWhere((o) => o.roomId == room.roomId);
        final patch = _roomPatch(before, room);
        if (patch.isNotEmpty) {
          final res = await _repo.updateRoom(original.id, room.roomId!, patch);
          requeued = requeued || res.requeued;
        }
      }

      // Upload + attach any newly-picked photos (existing ones are remote and are
      // skipped; there's no photo-delete endpoint, so removals are client-only).
      await _attachPendingPhotos(original.id, primaryFirst: false);

      state = state.copyWith(submitting: false);
      return requeued;
    } catch (e) {
      state = state.copyWith(submitting: false, error: apiExceptionFrom(e).message);
      return null;
    }
  }

  /// Only the listing-level fields that actually changed (so a no-op never
  /// needlessly re-queues — mirrors the backend classifier).
  Map<String, dynamic> _listingPatch(HostListing o) => {
        if (state.alias.trim() != o.alias) 'alias': state.alias.trim(),
        if (state.actualName.trim() != o.actualName) 'actualName': state.actualName.trim(),
        if (state.areaLabel.trim() != o.areaLabel) 'areaLabel': state.areaLabel.trim(),
        if (state.city.trim() != o.city) 'city': state.city.trim(),
        if (state.pincode != o.pincode) 'pincode': state.pincode,
        if (state.fullAddress.trim() != o.fullAddress) 'fullAddress': state.fullAddress.trim(),
        if (state.lat != o.lat) 'latitude': state.lat,
        if (state.lng != o.lng) 'longitude': state.lng,
        if (state.gender != o.gender) 'gender': state.gender,
        if (!_sameList(state.amenities, o.amenities)) 'amenities': state.amenities,
        if (!_sameList(state.houseRules, o.houseRules)) 'houseRules': state.houseRules,
        if (state.mealsOffered != o.mealsOffered) 'mealsOffered': state.mealsOffered,
        if (state.mealChargesPaise != o.mealCharges?.value) 'mealChargesPaise': state.mealChargesPaise,
        if (state.tokenAmountPaise != o.tokenAmount?.value) 'tokenAmountPaise': state.tokenAmountPaise,
        if (state.instantBook != o.instantBook) 'instantBook': state.instantBook,
      };

  Map<String, dynamic> _roomPatch(HostRoomInventory o, RoomDraft r) => {
        if (r.name.trim() != o.name) 'name': r.name.trim(),
        if (r.floor != o.floor) 'floor': r.floor,
        if (r.sharingType != o.sharingType) 'sharingType': r.sharingType,
        if (r.monthlyRentPaise != o.monthlyRent.value) 'monthlyRentPaise': r.monthlyRentPaise,
        if (r.depositPaise != o.deposit.value) 'depositPaise': r.depositPaise,
      };

  bool _sameList(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// Create/edit form controller. Pass a listing id to edit (the original is read
/// from [hostListingProvider]); pass null to create.
final listingFormControllerProvider = StateNotifierProvider.autoDispose
    .family<ListingFormController, ListingFormState, HostListing?>(
  (ref, original) => ListingFormController(ref.read(hostListingRepositoryProvider), original: original),
);
