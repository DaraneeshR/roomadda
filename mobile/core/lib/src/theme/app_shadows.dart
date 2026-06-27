import 'package:flutter/painting.dart';

import 'app_colors.dart';

/// Elevation tokens from design/README.md "Spacing / radius / shadow".
///
/// CSS → Flutter mapping (spread = CSS spread, blurRadius = CSS blur):
///   card  : 0 1px 2px ink@4%  +  0 0 0 1px ink@5%   (soft drop + hairline ring)
///   modal : 0 8px 24px -14px ink@18%                 (elevated / sheet)
///   ctaGlow: 0 12px 26px -10px accent@60%            (primary-button glow)
abstract final class AppShadows {
  /// Resting card: a soft drop plus a 1px hairline ring.
  static const List<BoxShadow> card = [
    BoxShadow(color: AppColors.shadowSoft, offset: Offset(0, 1), blurRadius: 2),
    BoxShadow(color: AppColors.shadowRing, blurRadius: 0, spreadRadius: 1),
  ];

  /// Elevated surfaces — sheets, modals, popovers.
  static const List<BoxShadow> modal = [
    BoxShadow(color: AppColors.shadowModal, offset: Offset(0, 8), blurRadius: 24, spreadRadius: -14),
  ];

  /// The coral glow under a primary CTA.
  static const List<BoxShadow> ctaGlow = [
    BoxShadow(color: AppColors.accentGlow, offset: Offset(0, 12), blurRadius: 26, spreadRadius: -10),
  ];
}
