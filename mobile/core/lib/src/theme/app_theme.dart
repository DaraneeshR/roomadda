import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_typography.dart';

/// The single light ThemeData for RoomAdda, assembled from the token files
/// (colors, typography, radii, shadows). Dark theme is out of scope for now.
///
/// Bespoke components (PrimaryButton, TrustTag, …) own their hero styling; this
/// theme just makes plain Material widgets land on-brand by default.
abstract final class AppTheme {
  static ThemeData get light {
    const colorScheme = ColorScheme.light(
      primary: AppColors.accent,
      onPrimary: AppColors.onAccent,
      secondary: AppColors.ink,
      onSecondary: AppColors.onInk,
      surface: AppColors.card,
      onSurface: AppColors.ink,
      error: AppColors.error,
      onError: AppColors.onAccent,
      outline: AppColors.hairlineStrong,
      outlineVariant: AppColors.hairline,
    );

    final textTheme = AppTypography.textTheme;

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.paper,
      canvasColor: AppColors.paper,
      textTheme: textTheme,
      // M3 tints cards toward primary by default — RoomAdda cards stay white.
      cardColor: AppColors.card,
      dividerColor: AppColors.hairline,
      dividerTheme: const DividerThemeData(
        color: AppColors.hairline,
        thickness: 1,
        space: 1,
      ),
      appBarTheme: AppBarTheme(
        centerTitle: false,
        backgroundColor: AppColors.paper,
        foregroundColor: AppColors.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleTextStyle: textTheme.titleLarge,
      ),
    );
  }
}
