import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/menu_repository.dart';
import '../domain/meal_menu.dart';

/// Today + tomorrow's menu for a listing (what the host edits). Invalidate after
/// a write so the editor reflects the saved state.
final menuDaysProvider = FutureProvider.autoDispose.family<List<MealMenuDay>, String>(
  (ref, listingId) => ref.read(menuRepositoryProvider).twoDayMenu(listingId),
);

/// Saved weekly templates for a listing.
final menuTemplatesProvider = FutureProvider.autoDispose.family<List<MealTemplate>, String>(
  (ref, listingId) => ref.read(menuRepositoryProvider).listTemplates(listingId),
);
