import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/menu_repository.dart';
import '../domain/meal_menu.dart';

/// Today + tomorrow's menu for a listing. Anchored on the device's local "today"
/// (passed as the date param). Auto-disposed when the menu tab is left.
final menuProvider = FutureProvider.autoDispose.family<List<MealMenuDay>, String>(
  (ref, listingId) => ref.read(menuRepositoryProvider).fetchMenu(listingId, date: DateTime.now()),
);
