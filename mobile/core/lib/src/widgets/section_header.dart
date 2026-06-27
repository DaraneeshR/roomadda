import 'package:flutter/material.dart';

import '../theme/app_typography.dart';

/// A mono eyebrow above a Plus Jakarta title (README "eyebrow label" + H2).
/// The eyebrow is uppercased for the kicker look.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.eyebrow,
    required this.title,
    this.trailing,
  });

  final String eyebrow;
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(eyebrow.toUpperCase(), style: AppTypography.eyebrow),
              const SizedBox(height: 6),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
            ],
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}
