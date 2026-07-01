import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/roster_repository.dart';
import '../domain/roster_tenant.dart';

/// A roster query: the listing + which scope (current / past) to show.
class RosterQuery {
  final String listingId;
  final String scope; // current / past
  const RosterQuery(this.listingId, this.scope);

  @override
  bool operator ==(Object other) =>
      other is RosterQuery && other.listingId == listingId && other.scope == scope;

  @override
  int get hashCode => Object.hash(listingId, scope);
}

/// The roster for a listing + scope. Current (default) or past tenants — NO KYC,
/// NO cross-tenant data.
final rosterProvider = FutureProvider.autoDispose.family<List<RosterTenant>, RosterQuery>(
  (ref, query) => ref.read(rosterRepositoryProvider).list(query.listingId, scope: query.scope),
);
