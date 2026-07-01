import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/host_service_repository.dart';
import '../domain/host_service_request.dart';

/// The host's service queue (escalated-first, then newest) with rollup stats.
/// Invalidate after acknowledge / note / resolve.
final serviceQueueProvider = FutureProvider.autoDispose<HostServiceQueue>(
  (ref) => ref.read(hostServiceRepositoryProvider).queue(limit: 50),
);

/// One request's detail (with its comment/note thread).
final serviceRequestProvider = FutureProvider.autoDispose.family<HostServiceRequest, String>(
  (ref, id) => ref.read(hostServiceRepositoryProvider).detail(id),
);
