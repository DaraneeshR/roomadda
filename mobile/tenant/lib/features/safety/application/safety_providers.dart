import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/leave_notice_repository.dart';
import '../data/safety_repository.dart';
import '../domain/leave_notice.dart';
import '../domain/trusted_contact.dart';

/// The tenant's leave notices + policy. Invalidate after serving/withdrawing.
final leaveNoticeProvider = FutureProvider.autoDispose<LeaveNoticeView>(
  (ref) => ref.read(leaveNoticeRepositoryProvider).fetchMine(),
);

/// The tenant's trusted contacts (+ the cap). Invalidate after add/remove.
final trustedContactsProvider = FutureProvider.autoDispose<TrustedContactsView>(
  (ref) => ref.read(safetyRepositoryProvider).fetchContacts(),
);

/// The caller's self-declared gender (from GET /v1/me), used only to nudge female
/// tenants to set up trusted contacts. Null when unknown / not set.
final selfGenderProvider = FutureProvider<String?>((ref) async {
  final res = await ref.read(dioProvider).get<dynamic>('/v1/me');
  final user = (res.data as Map<String, dynamic>)['user'] as Map<String, dynamic>;
  return user['gender'] as String?;
});
