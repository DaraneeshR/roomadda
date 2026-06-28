import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

/// One Google Places autocomplete suggestion.
class PlaceSuggestion {
  final String placeId;
  final String description;
  const PlaceSuggestion({required this.placeId, required this.description});
}

/// A resolved place location (locality/landmark/college/metro/company).
class PlaceLocation {
  final double lat;
  final double lng;
  final String label;
  const PlaceLocation({required this.lat, required this.lng, required this.label});
}

/// Google Places lookups for the smart search bar. An interface so the search
/// flow is unit-testable with a fake (no network / no API key).
abstract class PlacesService {
  Future<List<PlaceSuggestion>> autocomplete(String input);
  Future<PlaceLocation?> details(String placeId);
}

/// Live implementation over the Google Places Web Service (HTTP, India-scoped).
/// Uses a bare Dio — this is a third-party host, NOT our backend, so it must not
/// carry our auth interceptor. When no API key is configured it degrades to no
/// suggestions, letting the user fall back to free-text city/area search.
class GooglePlacesService implements PlacesService {
  GooglePlacesService({Dio? dio, String? apiKey})
      : _dio = dio ?? Dio(),
        _key = apiKey ?? Env.googlePlacesApiKey;

  final Dio _dio;
  final String _key;

  static const _base = 'https://maps.googleapis.com/maps/api/place';
  bool get _enabled => _key.isNotEmpty;

  @override
  Future<List<PlaceSuggestion>> autocomplete(String input) async {
    if (!_enabled || input.trim().length < 3) return const [];
    try {
      final res = await _dio.get<dynamic>('$_base/autocomplete/json', queryParameters: {
        'input': input,
        'key': _key,
        'components': 'country:in',
      });
      final preds = (res.data as Map<String, dynamic>)['predictions'] as List<dynamic>? ?? const [];
      return preds
          .map((p) => PlaceSuggestion(
                placeId: (p as Map<String, dynamic>)['place_id'] as String,
                description: p['description'] as String,
              ))
          .toList();
    } catch (_) {
      // Suggestions are a convenience — never block search on a Places failure.
      return const [];
    }
  }

  @override
  Future<PlaceLocation?> details(String placeId) async {
    if (!_enabled) return null;
    try {
      final res = await _dio.get<dynamic>('$_base/details/json', queryParameters: {
        'place_id': placeId,
        'key': _key,
        'fields': 'geometry,name,formatted_address',
      });
      final result = (res.data as Map<String, dynamic>)['result'] as Map<String, dynamic>?;
      final loc = (result?['geometry'] as Map<String, dynamic>?)?['location'] as Map<String, dynamic>?;
      if (loc == null) return null;
      return PlaceLocation(
        lat: (loc['lat'] as num).toDouble(),
        lng: (loc['lng'] as num).toDouble(),
        label: (result?['formatted_address'] ?? result?['name'] ?? '') as String,
      );
    } catch (_) {
      return null;
    }
  }
}

final placesServiceProvider = Provider<PlacesService>((ref) => GooglePlacesService());

/// Debounced-by-key autocomplete results for the current query.
final placesAutocompleteProvider = FutureProvider.autoDispose
    .family<List<PlaceSuggestion>, String>((ref, input) => ref.read(placesServiceProvider).autocomplete(input));
