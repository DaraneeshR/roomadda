import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_radii.dart';
import '../theme/app_shadows.dart';
import '../theme/app_typography.dart';

/// Primary CTA — an accent pill carrying the coral glow (README "Primary
/// button": bg accent, white 700/16, glow shadow).
///
/// A null [onPressed] disables it (the glow drops and the surface mutes).
/// Defaults to hugging its content; set [expand] to fill the available width.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.expand = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final fg = enabled ? AppColors.onAccent : AppColors.faintInk;

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: AppRadii.pillBorder,
        boxShadow: enabled ? AppShadows.ctaGlow : null,
      ),
      child: Material(
        color: enabled ? AppColors.accent : AppColors.hairlineStrong,
        borderRadius: AppRadii.pillBorder,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Row(
              mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18, color: fg),
                  const SizedBox(width: 8),
                ],
                Text(label, style: AppTypography.button.copyWith(color: fg)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
