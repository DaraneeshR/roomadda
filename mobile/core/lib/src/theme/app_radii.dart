import 'package:flutter/painting.dart';

/// Corner-radius tokens from design/README.md "Spacing / radius / shadow".
///
/// README ranges: chips/pills 999 · inputs/small 11–15 · cards 16–22 ·
/// sheets/large 24–32. We pick one representative value per family.
abstract final class AppRadii {
  /// Pills, chips, trust tags, buttons.
  static const double pill = 999;

  /// Inputs and small controls (README 11–15).
  static const double input = 12;

  /// Cards (README 16–22).
  static const double card = 18;

  /// Bottom sheets / large surfaces (README 24–32).
  static const double sheet = 28;

  static const BorderRadius pillBorder = BorderRadius.all(Radius.circular(pill));
  static const BorderRadius inputBorder = BorderRadius.all(Radius.circular(input));
  static const BorderRadius cardBorder = BorderRadius.all(Radius.circular(card));
  static const BorderRadius sheetBorder = BorderRadius.all(Radius.circular(sheet));
}
