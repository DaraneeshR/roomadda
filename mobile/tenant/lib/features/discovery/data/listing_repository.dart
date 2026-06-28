import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/filters.dart';
import '../domain/listing.dart';

/// Reads the masked discovery endpoints. All calls go through the core dio
/// (base URL + auth/refresh + error interceptors); every path returns the
/// MASKED public shape — this layer never sees actualName/fullAddress/exact geo.
class ListingRepository {
  final Dio _dio;
  ListingRepository(this._dio);

  /// Filtered, cursor-paginated browse — `GET /v1/listings`.
  Future<ListingsPage> browse(ListingFilters filters, {String? cursor, int limit = 15}) async {
    final res = await _dio.get<dynamic>('/v1/listings', queryParameters: {
      ...filters.toQuery(),
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
    });
    final data = res.data as Map<String, dynamic>;
    return ListingsPage(
      items: (data['items'] as List<dynamic>)
          .map((e) => PublicListing.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: data['nextCursor'] as String?,
    );
  }

  /// A single listing — `GET /v1/listings/:id` (masked for a non-confirmed tenant).
  Future<PublicListing> detail(String id) async {
    final res = await _dio.get<dynamic>('/v1/listings/$id');
    return PublicListing.fromJson((res.data as Map<String, dynamic>)['listing'] as Map<String, dynamic>);
  }

  /// Nearby listings — `GET /v1/listings/search/nearby` (ST_DWithin, index-backed).
  /// Each item carries `distanceMeters`.
  Future<List<PublicListing>> nearby({
    required double lat,
    required double lng,
    required int radiusM,
    int limit = 30,
  }) async {
    final res = await _dio.get<dynamic>('/v1/listings/search/nearby', queryParameters: {
      'lat': '$lat',
      'lng': '$lng',
      'radiusM': '$radiusM',
      'limit': '$limit',
    });
    return ((res.data as Map<String, dynamic>)['items'] as List<dynamic>)
        .map((e) => PublicListing.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}

final listingRepositoryProvider =
    Provider<ListingRepository>((ref) => ListingRepository(ref.read(dioProvider)));
