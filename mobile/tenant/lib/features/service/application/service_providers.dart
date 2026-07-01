import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/service_repository.dart';
import '../domain/service_request.dart';

/// The tenant's service requests (newest first). Invalidate to refresh after
/// raising a new one.
final serviceRequestsProvider = FutureProvider.autoDispose<ServiceRequestPage>(
  (ref) => ref.read(serviceRepositoryProvider).listMine(limit: 50),
);

/// One request's detail (status + comment thread), re-fetched on demand.
final serviceRequestProvider = FutureProvider.autoDispose.family<ServiceRequest, String>(
  (ref, id) => ref.read(serviceRepositoryProvider).fetchDetail(id),
);
