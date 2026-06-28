import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../discovery/domain/listing.dart';

/// The caller's saved listings — backed by the per-user, masked
/// `/v1/wishlist` endpoints (shared with the web tenant account).
class WishlistRepository {
  final Dio _dio;
  WishlistRepository(this._dio);

  Future<List<PublicListing>> list({String? cursor, int limit = 20}) async {
    final res = await _dio.get<dynamic>('/v1/wishlist', queryParameters: {
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
    });
    return ((res.data as Map<String, dynamic>)['items'] as List<dynamic>)
        .map((e) => PublicListing.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> add(String listingId) => _dio.post<dynamic>('/v1/wishlist/$listingId');

  Future<void> remove(String listingId) => _dio.delete<dynamic>('/v1/wishlist/$listingId');
}

final wishlistRepositoryProvider =
    Provider<WishlistRepository>((ref) => WishlistRepository(ref.read(dioProvider)));
