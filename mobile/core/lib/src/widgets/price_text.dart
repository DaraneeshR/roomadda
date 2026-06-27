import 'package:flutter/material.dart';

import '../money/paise.dart';
import '../theme/app_colors.dart';
import '../theme/app_typography.dart';

/// Renders a [Paise] amount in the monospace price style (README: prices use
/// JetBrains Mono; the accent is reserved for the price highlight).
///
/// Formatting goes through the existing [Paise.format] — this widget never does
/// money math (see /CLAUDE.md: money is always integer paise).
class PriceText extends StatelessWidget {
  const PriceText(
    this.amount, {
    super.key,
    this.fontSize = 18,
    this.fontWeight = FontWeight.w700,
    this.color = AppColors.ink,
  });

  final Paise amount;
  final double fontSize;
  final FontWeight fontWeight;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(
        amount.format(),
        style: AppTypography.priceStyle(
          fontSize: fontSize,
          fontWeight: fontWeight,
          color: color,
        ),
      );
}
