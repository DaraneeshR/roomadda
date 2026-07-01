import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/host_listing.dart';

/// A presigned upload target for one on-device listing photo: the [uploadUrl] to
/// PUT the bytes to, and the [publicUrl] to attach once uploaded. Listing photos
/// are public, so the served URL (not just a key) comes back.
class ListingPhotoUploadTarget {
  final String key;
  final String uploadUrl;
  final String publicUrl;

  const ListingPhotoUploadTarget({
    required this.key,
    required this.uploadUrl,
    required this.publicUrl,
  });
}

/// Result of a host edit — the updated listing plus the AUTHORITATIVE re-queue
/// decision from the server (the client only predicts it for a pre-save warning;
/// this is the truth, /CLAUDE.md).
class HostListingEditResult {
  final HostListing listing;
  final bool requeued;
  final List<String> changedFields;

  const HostListingEditResult({
    required this.listing,
    required this.requeued,
    required this.changedFields,
  });
}

/// Talks to the host listing-lifecycle + inventory endpoints (`/host/listings/*`)
/// and the listing build endpoints (`/listings`, rooms, beds, photos) used by the
/// create flow. Every host route is ownership-scoped server-side; a foreign id is
/// a 404. Listing status (DRAFT/PENDING_REVIEW/PUBLISHED) is server-owned — the
/// app reads it and requests transitions (publish/pause), never sets it directly.
class HostListingRepository {
  final Dio _dio;
  HostListingRepository(this._dio);

  Future<HostListingPage> list({String? cursor, int limit = 30}) async {
    final res = await _dio.get<dynamic>(
      '/v1/host/listings',
      queryParameters: {'limit': limit, if (cursor != null) 'cursor': cursor},
    );
    final data = res.data as Map<String, dynamic>;
    return HostListingPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => HostListing.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  Future<HostListing> detail(String id) async {
    final res = await _dio.get<dynamic>('/v1/host/listings/$id');
    return HostListing.fromJson((res.data as Map<String, dynamic>)['listing'] as Map<String, dynamic>);
  }

  /// Patch host-managed listing fields. The server classifies whether the change
  /// re-queues for approval and returns that verdict.
  Future<HostListingEditResult> updateListing(String id, Map<String, dynamic> patch) async {
    final res = await _dio.patch<dynamic>('/v1/host/listings/$id', data: patch);
    return _editResult(res.data as Map<String, dynamic>);
  }

  Future<HostListingEditResult> updateRoom(String id, String roomId, Map<String, dynamic> patch) async {
    final res = await _dio.patch<dynamic>('/v1/host/listings/$id/rooms/$roomId', data: patch);
    return _editResult(res.data as Map<String, dynamic>);
  }

  Future<HostListing> publish(String id) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$id/publish');
    return _listing(res.data);
  }

  Future<HostListing> setPaused(String id, bool paused) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$id/${paused ? 'pause' : 'unpause'}');
    return _listing(res.data);
  }

  Future<List<ListingEditLogItem>> editHistory(String id, {int limit = 30}) async {
    final res = await _dio.get<dynamic>('/v1/host/listings/$id/edit-history', queryParameters: {'limit': limit});
    return ((res.data as Map<String, dynamic>)['items'] as List<dynamic>)
        .map((e) => ListingEditLogItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  // --- Inventory ------------------------------------------------------------

  /// Clear a room's "not verified" flag (host confirms the occupancy is accurate).
  Future<HostListing> verifyInventory(String id, String roomId) async {
    final res = await _dio.post<dynamic>('/v1/host/listings/$id/rooms/$roomId/verify-inventory');
    return _listing(res.data);
  }

  /// Manually BLOCK / UNBLOCK beds in a room (walk-in adjust, flagged distinctly).
  Future<HostListing> adjustInventory(String id, String roomId, String action, int count) async {
    final res = await _dio.post<dynamic>(
      '/v1/host/listings/$id/rooms/$roomId/adjust-inventory',
      data: {'action': action, 'count': count},
    );
    return _listing(res.data);
  }

  // --- Create flow (listing build endpoints) --------------------------------

  /// Create a DRAFT listing (step 1 basics). Returns its new id.
  Future<String> createListing(Map<String, dynamic> body) async {
    final res = await _dio.post<dynamic>('/v1/listings', data: body);
    return ((res.data as Map<String, dynamic>)['listing'] as Map<String, dynamic>)['id'] as String;
  }

  /// Add a room; returns its id (used to attach beds).
  Future<String> addRoom(String listingId, Map<String, dynamic> body) async {
    final res = await _dio.post<dynamic>('/v1/listings/$listingId/rooms', data: body);
    return ((res.data as Map<String, dynamic>)['room'] as Map<String, dynamic>)['id'] as String;
  }

  Future<void> addBed(String listingId, String roomId, Map<String, dynamic> body) async {
    await _dio.post<dynamic>('/v1/listings/$listingId/rooms/$roomId/beds', data: body);
  }

  Future<void> addPhoto(String listingId, Map<String, dynamic> body) async {
    await _dio.post<dynamic>('/v1/listings/$listingId/photos', data: body);
  }

  /// Ask the server for a presigned PUT URL for one on-device photo. Ownership-
  /// scoped server-side (a foreign id is 404).
  Future<ListingPhotoUploadTarget> requestPhotoUploadUrl(String listingId, String contentType) async {
    final res = await _dio.post<dynamic>(
      '/v1/listings/$listingId/photos/upload-url',
      data: {'contentType': contentType},
    );
    final data = res.data as Map<String, dynamic>;
    return ListingPhotoUploadTarget(
      key: data['key'] as String,
      uploadUrl: data['uploadUrl'] as String,
      publicUrl: data['publicUrl'] as String,
    );
  }

  /// PUT the bytes straight to the public bucket (bare Dio: the URL is fully
  /// qualified + pre-authorized). Only Content-Type is pinned — no SSE header,
  /// since listing photos live in a public-read bucket, not the private one.
  Future<void> uploadPhotoBytes(String uploadUrl, Uint8List bytes, String contentType) async {
    await Dio().put<dynamic>(
      uploadUrl,
      data: Stream<List<int>>.fromIterable([bytes]),
      options: Options(headers: {'Content-Type': contentType, 'Content-Length': bytes.length}),
    );
  }

  HostListing _listing(dynamic data) =>
      HostListing.fromJson((data as Map<String, dynamic>)['listing'] as Map<String, dynamic>);

  HostListingEditResult _editResult(Map<String, dynamic> data) => HostListingEditResult(
        listing: HostListing.fromJson(data['listing'] as Map<String, dynamic>),
        requeued: data['requeued'] as bool,
        changedFields: (data['changedFields'] as List<dynamic>? ?? const []).map((e) => e as String).toList(),
      );
}

final hostListingRepositoryProvider =
    Provider<HostListingRepository>((ref) => HostListingRepository(ref.read(dioProvider)));
