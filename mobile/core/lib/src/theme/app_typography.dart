import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// Type tokens from design/README.md "Typography".
///
/// Display & body = Plus Jakarta Sans (400/500/600/700/800). Eyebrows, labels,
/// prices, IDs and the tagline = JetBrains Mono (500).
///
/// README tracking is given in `em`; Flutter wants logical px, so per style
/// `letterSpacing = em * fontSize` (large headings −0.02..−0.035em; mono
/// eyebrows +0.1..+0.22em). The computed px is noted inline.
abstract final class AppTypography {
  // ── Plus Jakarta Sans scale → Material TextTheme ──────────────────────────
  static TextTheme get textTheme => TextTheme(
        // Display 40–64 / 800
        displayLarge: _jakarta(56, FontWeight.w800, ls: -1.96, height: 1.02), // −0.035em
        displayMedium: _jakarta(44, FontWeight.w800, ls: -1.41, height: 1.03), // −0.032em
        displaySmall: _jakarta(34, FontWeight.w800, ls: -1.02, height: 1.05), // −0.03em
        // H1 22–30 / 800
        headlineLarge: _jakarta(30, FontWeight.w800, ls: -0.66, height: 1.08), // −0.022em
        headlineMedium: _jakarta(26, FontWeight.w800, ls: -0.52, height: 1.1), // −0.02em
        headlineSmall: _jakarta(22, FontWeight.w800, ls: -0.44, height: 1.12), // −0.02em
        // H2 19–21 / 800
        titleLarge: _jakarta(21, FontWeight.w800, ls: -0.32, height: 1.15), // −0.015em
        titleMedium: _jakarta(19, FontWeight.w700, ls: -0.19, height: 1.2), // −0.01em
        titleSmall: _jakarta(16, FontWeight.w700, height: 1.25),
        // Body 14–17 / 400–500
        bodyLarge: _jakarta(17, FontWeight.w500, height: 1.5),
        bodyMedium: _jakarta(15, FontWeight.w400, height: 1.5),
        bodySmall: _jakarta(14, FontWeight.w400, height: 1.5, color: AppColors.mutedInk),
        // Labels 11–13
        labelLarge: _jakarta(14, FontWeight.w600, height: 1.2),
        labelMedium: _jakarta(12, FontWeight.w600, height: 1.2),
        labelSmall: _jakarta(11, FontWeight.w600, height: 1.2),
      );

  /// Primary/secondary button label — Plus Jakarta 700 / 16 (README).
  static TextStyle get button =>
      _jakarta(16, FontWeight.w700, height: 1.0);

  // ── JetBrains Mono utilities (no TextTheme slot is mono) ──────────────────

  /// Eyebrow / kicker label. Intended for UPPERCASED text; tracking +0.18em.
  static TextStyle get eyebrow => _mono(
        12,
        FontWeight.w500,
        ls: 2.16, // +0.18em
        color: AppColors.mutedInk,
      );

  /// The "STAY · GROW · BELONG" tagline; tracking +0.22em.
  static TextStyle get tagline => _mono(
        11,
        FontWeight.w500,
        ls: 2.42, // +0.22em
        color: AppColors.mutedInk,
      );

  /// Monospace price/amount style (used by PriceText). Mono keeps digits
  /// tabular so prices align.
  static TextStyle priceStyle({
    double fontSize = 18,
    FontWeight fontWeight = FontWeight.w700,
    Color color = AppColors.ink,
  }) =>
      _mono(fontSize, fontWeight, color: color);

  // ── Builders ──────────────────────────────────────────────────────────────
  static TextStyle _jakarta(
    double size,
    FontWeight weight, {
    double? ls,
    double? height,
    Color color = AppColors.ink,
  }) =>
      GoogleFonts.plusJakartaSans(
        fontSize: size,
        fontWeight: weight,
        letterSpacing: ls,
        height: height,
        color: color,
      );

  static TextStyle _mono(
    double size,
    FontWeight weight, {
    double? ls,
    Color color = AppColors.ink,
  }) =>
      GoogleFonts.jetBrainsMono(
        fontSize: size,
        fontWeight: weight,
        letterSpacing: ls,
        color: color,
      );
}
