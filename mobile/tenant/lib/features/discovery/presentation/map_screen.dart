import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/discovery_providers.dart';
import '../application/listings_controller.dart';
import '../domain/listing.dart';

/// Map view of nearby PGs (ST_DWithin results). Each pin's info window carries
/// the alias + starting rent; tapping it opens the masked detail. Centred on the
/// searched place, falling back to a city centre when the search had no geo.
class MapScreen extends ConsumerWidget {
  const MapScreen({super.key});

  static const _fallback = GeoPoint(12.9716, 77.5946); // Bengaluru
  static const _radiusM = 5000;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final geo = ref.watch(listingsControllerProvider.select((s) => s.geo)) ?? _fallback;
    final query = (lat: geo.lat, lng: geo.lng, radiusM: _radiusM);
    final async = ref.watch(nearbyProvider(query));

    return Scaffold(
      appBar: AppBar(title: const Text('Nearby PGs')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(apiExceptionFrom(e).message)),
        data: (listings) => GoogleMap(
          initialCameraPosition: CameraPosition(target: LatLng(geo.lat, geo.lng), zoom: 13),
          myLocationButtonEnabled: false,
          markers: _markers(context, listings),
        ),
      ),
    );
  }

  Set<Marker> _markers(BuildContext context, List<PublicListing> listings) {
    return {
      for (final l in listings)
        Marker(
          markerId: MarkerId(l.id),
          position: LatLng(l.approxLocation.lat, l.approxLocation.lng),
          infoWindow: InfoWindow(
            title: l.alias,
            snippet: l.startingRent != null ? '${l.startingRent!.format()} /mo' : 'Price on request',
            onTap: () => context.push('/tenant/listing/${l.id}'),
          ),
        ),
    };
  }
}
