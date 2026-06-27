import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_radii.dart';

/// Which trust/merchandising signal a [TrustTag] conveys.
enum TrustTagVariant { verified, agentVisited, sponsored }

/// A small wash-filled pill with an icon + label (README "Badge" recipe:
/// wash pill, fill icon, 700/11px). Variants map to the status palette:
/// Verified = green, Agent-visited = blue, Sponsored = amber.
class TrustTag extends StatelessWidget {
  const TrustTag({super.key, required this.variant, this.label});

  final TrustTagVariant variant;

  /// Overrides the variant's default label text.
  final String? label;

  @override
  Widget build(BuildContext context) {
    final spec = _specFor(variant);
    final textStyle = (Theme.of(context).textTheme.labelSmall ?? const TextStyle())
        .copyWith(color: spec.fg, fontWeight: FontWeight.w700, letterSpacing: 0.2);

    return DecoratedBox(
      decoration: BoxDecoration(color: spec.bg, borderRadius: AppRadii.pillBorder),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(spec.icon, size: 13, color: spec.fg),
            const SizedBox(width: 5),
            Text(label ?? spec.label, style: textStyle),
          ],
        ),
      ),
    );
  }

  _TagSpec _specFor(TrustTagVariant variant) => switch (variant) {
        TrustTagVariant.verified => const _TagSpec(
            'Verified', Icons.verified, AppColors.verified, AppColors.verifiedWash),
        TrustTagVariant.agentVisited => const _TagSpec(
            'Agent-visited', Icons.assignment_turned_in, AppColors.agentVisited, AppColors.agentVisitedWash),
        TrustTagVariant.sponsored => const _TagSpec(
            'Sponsored', Icons.star, AppColors.sponsored, AppColors.sponsoredWash),
      };
}

class _TagSpec {
  const _TagSpec(this.label, this.icon, this.fg, this.bg);
  final String label;
  final IconData icon;
  final Color fg;
  final Color bg;
}
