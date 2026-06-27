import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_radii.dart';
import '../theme/app_shadows.dart';
import '../theme/app_typography.dart';

/// A presentational listing-card shell: white surface, card radius + hairline
/// shadow, a media header (gradient placeholder by default — README: "never a
/// grey box"), and a content slot. No data wiring — screens compose into it.
class ListingCard extends StatelessWidget {
  const ListingCard({
    super.key,
    this.media,
    this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
  });

  /// Header media; defaults to the branded gradient placeholder.
  final Widget? media;

  /// Content below the media.
  final Widget? child;

  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        boxShadow: AppShadows.card,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: AppRadii.cardBorder,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AspectRatio(
                aspectRatio: 16 / 10,
                child: media ?? const _GradientPlaceholder(),
              ),
              if (child != null) Padding(padding: padding, child: child),
            ],
          ),
        ),
      ),
    );
  }
}

/// The "photos coming soon" fallback — a soft brand gradient, never grey.
class _GradientPlaceholder extends StatelessWidget {
  const _GradientPlaceholder();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.accentWash, AppColors.paperAlt],
        ),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.image_outlined, size: 28, color: AppColors.faintInk),
            const SizedBox(height: 8),
            Text('PHOTOS COMING SOON', style: AppTypography.eyebrow),
          ],
        ),
      ),
    );
  }
}
