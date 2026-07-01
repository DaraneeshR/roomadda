import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/walk_in_repository.dart';
import '../domain/walk_in_tenant.dart';

/// Current walk-ins for a listing (checked-out excluded). Invalidate after
/// recording a new walk-in or checking one out.
final walkInsProvider = FutureProvider.autoDispose.family<WalkInPage, String>(
  (ref, listingId) => ref.read(walkInRepositoryProvider).list(listingId, limit: 50),
);
