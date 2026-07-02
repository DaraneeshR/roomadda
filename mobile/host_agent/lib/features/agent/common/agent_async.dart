import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

/// Whether [error] means "the network is unreachable" (agents work inside
/// buildings with poor signal) as opposed to a real server rejection. A missing
/// HTTP response — a connect/receive timeout or a DNS/socket failure — is offline;
/// a 4xx/5xx that came *back* from the server is a genuine error we must surface.
bool isOfflineError(Object error) {
  final api = apiExceptionFrom(error);
  if (api.statusCode != null) return false; // the server answered → not offline
  if (api.code == 'NETWORK_ERROR') return true;
  if (error is DioException) {
    return error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout;
  }
  return false;
}

/// The state of an offline-tolerant fetch. [data] is the last value we can show
/// (fresh OR last-synced from cache); [fromCache] flags that it is stale because
/// the live fetch failed offline. [error] is set only when there is nothing at all
/// to show. This lets a screen keep rendering last-synced data behind a banner
/// instead of blanking out when the signal drops.
@immutable
class OfflineState<T> {
  const OfflineState({
    this.data,
    this.loading = false,
    this.fromCache = false,
    this.error,
  });

  final T? data;
  final bool loading;
  final bool fromCache;
  final String? error;

  bool get hasData => data != null;

  OfflineState<T> copyWith({T? data, bool? loading, bool? fromCache, String? error}) => OfflineState<T>(
        data: data ?? this.data,
        loading: loading ?? this.loading,
        fromCache: fromCache ?? this.fromCache,
        error: error, // nullable-reset: pass null to clear
      );
}

/// Renders an [OfflineState]: a skeleton while first-loading, an error+retry when
/// there is nothing to show, otherwise the data — with an [OfflineBanner] on top
/// whenever the data is last-synced (offline). A failed fetch never blanks the
/// screen and never crashes; it degrades to cached-behind-a-banner or a retry.
class OfflineBody<T> extends StatelessWidget {
  const OfflineBody({
    super.key,
    required this.state,
    required this.data,
    required this.onRetry,
    this.skeleton,
  });

  final OfflineState<T> state;
  final Widget Function(T data) data;
  final Future<void> Function() onRetry;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    if (!state.hasData) {
      if (state.loading) return skeleton ?? const Center(child: CircularProgressIndicator());
      return AgentErrorRetry(message: state.error ?? 'Something went wrong.', onRetry: onRetry);
    }
    return Column(
      children: [
        if (state.fromCache) OfflineBanner(onRetry: onRetry, loading: state.loading),
        Expanded(child: data(state.data as T)),
      ],
    );
  }
}

/// Renders an [AsyncValue] with the agent surface's shared affordances: a skeleton
/// while loading and an error state that ALWAYS offers a retry (a failed call
/// surfaces a retry, never a crash). Used by the simpler read-only screens.
class AgentAsync<T> extends StatelessWidget {
  const AgentAsync({super.key, required this.value, required this.data, required this.onRetry, this.skeleton});

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback onRetry;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: false,
      loading: () => skeleton ?? const Center(child: CircularProgressIndicator()),
      error: (e, _) => AgentErrorRetry(message: apiExceptionFrom(e).message, onRetry: () async => onRetry()),
      data: data,
    );
  }
}

/// A thin banner shown above last-synced data when the live fetch is offline.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.onRetry, this.loading = false});

  final Future<void> Function() onRetry;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.sponsoredWash,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        child: Row(
          children: [
            const Icon(Icons.cloud_off, size: 16, color: AppColors.sponsored),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'Offline — showing last-synced data',
                style: TextStyle(color: AppColors.sponsored, fontWeight: FontWeight.w600, fontSize: 12),
              ),
            ),
            if (loading)
              const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
            else
              TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}

/// A friendly error block with a retry button — used wherever a fetch can fail.
class AgentErrorRetry extends StatelessWidget {
  const AgentErrorRetry({super.key, required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, color: AppColors.faintInk, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.mutedInk)),
            const SizedBox(height: 16),
            SecondaryButton(label: 'Retry', icon: Icons.refresh, onPressed: () => onRetry()),
          ],
        ),
      ),
    );
  }
}

/// A simple placeholder block for skeleton loaders.
class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.height = 16, this.width, this.radius = 8});

  final double height;
  final double? width;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      width: width,
      decoration: BoxDecoration(color: AppColors.paperAlt, borderRadius: BorderRadius.circular(radius)),
    );
  }
}

/// A stack of card-shaped skeletons (the default list/loading shape).
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.count = 4, this.height = 96});

  final int count;
  final double height;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
      itemCount: count,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (_, __) => SkeletonBox(height: height, radius: AppRadii.card),
    );
  }
}

/// Empty-state message centered in a scrollable so pull-to-refresh still works.
class AgentEmpty extends StatelessWidget {
  const AgentEmpty({super.key, required this.message, this.icon});

  final String message;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 100),
        if (icon != null) Icon(icon, size: 44, color: AppColors.faintInk),
        const SizedBox(height: 12),
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.mutedInk)),
          ),
        ),
      ],
    );
  }
}
