import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/stay_repository.dart';
import '../domain/active_stay.dart';

/// The tenant's current active stay (or null). App-scoped so the home shell can
/// watch it to decide whether to show the post-move-in dashboard or the browse
/// surface. `invalidate` it to re-check after a booking confirms or on resume.
final activeStayProvider = FutureProvider<ActiveStay?>(
  (ref) => ref.read(stayRepositoryProvider).fetchActiveStay(),
);
