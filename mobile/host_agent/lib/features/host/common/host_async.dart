import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

/// Renders an [AsyncValue] with the host surface's shared affordances: a skeleton
/// while loading, and an error state that ALWAYS offers a retry (a failed call
/// surfaces a retry, never a crash). Pass [skeleton] to show feature-shaped
/// placeholders; otherwise a centered spinner is used.
class HostAsync<T> extends StatelessWidget {
  const HostAsync({
    super.key,
    required this.value,
    required this.data,
    required this.onRetry,
    this.skeleton,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback onRetry;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: false,
      loading: () => skeleton ?? const Center(child: CircularProgressIndicator()),
      error: (e, _) => HostErrorRetry(message: apiExceptionFrom(e).message, onRetry: onRetry),
      data: data,
    );
  }
}

/// A friendly error block with a retry button — used wherever a fetch can fail.
class HostErrorRetry extends StatelessWidget {
  const HostErrorRetry({super.key, required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

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
            SecondaryButton(label: 'Retry', icon: Icons.refresh, onPressed: onRetry),
          ],
        ),
      ),
    );
  }
}

/// A simple animated shimmer placeholder block for skeleton loaders.
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
      decoration: BoxDecoration(
        color: AppColors.paperAlt,
        borderRadius: BorderRadius.circular(radius),
      ),
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
class HostEmpty extends StatelessWidget {
  const HostEmpty({super.key, required this.message, this.icon});

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
