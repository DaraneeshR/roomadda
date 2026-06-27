import 'package:flutter/painting.dart';

/// RoomAdda color tokens — the ONLY place raw hex lives in the app.
///
/// Values are taken verbatim from design/README.md "Design Tokens". Anything
/// downstream (themes, widgets, screens) must reference these named constants;
/// no raw `Color(0x..)` outside this file.
abstract final class AppColors {
  // ── Core surfaces & text ────────────────────────────────────────────────
  /// Primary text, dark surfaces, primary buttons on light.
  static const Color ink = Color(0xFF1C1A17);

  /// Default light screen background.
  static const Color paper = Color(0xFFFBF9F5);

  /// Secondary background (cards-on-cards, chips).
  static const Color paperAlt = Color(0xFFF4F1EB);

  /// Cards, sheets.
  static const Color card = Color(0xFFFFFFFF);

  /// Secondary text.
  static const Color mutedInk = Color(0xFF6B655C);

  /// Tertiary text, placeholders.
  static const Color faintInk = Color(0xFF9A938A);

  /// Text on the accent/primary button.
  static const Color onAccent = Color(0xFFFFFFFF);

  /// Text on dark (ink) surfaces / dark buttons.
  static const Color onInk = Color(0xFFF7F4EE);

  // ── Primary accent ──────────────────────────────────────────────────────
  /// Primary CTAs, active state, brand dot, price.
  static const Color accent = Color(0xFFD6483B);

  /// Red-tinted chips / soft fills.
  static const Color accentWash = Color(0xFFFBEDEB);

  // ── Status palette ────────────────────────────────────────────────────────
  // Semantic trust/status names mapped onto the README colors. The mapping is
  // spelled out per line so it stays auditable against the spec.

  /// Verified — README "Verified green".
  static const Color verified = Color(0xFF2F8A5B);
  static const Color verifiedWash = Color(0xFFE9F4EE); // README "Green wash".

  /// Agent-visited — README "Blue (info)" (agent accents).
  static const Color agentVisited = Color(0xFF3A5B8A);
  static const Color agentVisitedWash = Color(0xFFEEF1F6); // README "Blue wash".

  /// Sponsored / featured — README "Amber" (warning / in-review / promotional).
  /// Amber (not the featured-badge red) keeps it distinct from [error].
  static const Color sponsored = Color(0xFFC9892E);
  static const Color sponsoredWash = Color(0xFFFBF3E8); // README "Amber wash".

  /// Error / destructive — the README red is the destructive hue.
  static const Color error = accent;
  static const Color errorWash = accentWash;

  // ── Hairlines / dividers ──────────────────────────────────────────────────
  /// Borders, dividers (light).
  static const Color hairline = Color(0xFFECE7DE);

  /// Borders, dividers (stronger — e.g. the secondary-button ring).
  static const Color hairlineStrong = Color(0xFFE4DED4);

  // ── Agent green hero gradient (README "Agent green hero") ──────────────────
  static const Color agentHeroStart = Color(0xFF2F8A5B);
  static const Color agentHeroEnd = Color(0xFF247048);

  // ── Shadow tints ──────────────────────────────────────────────────────────
  // Ink/accent at the README shadow opacities, with alpha baked into the hex so
  // there is no runtime opacity math and the values can stay `const`. Consumed
  // only by app_shadows.dart.
  static const Color shadowSoft = Color(0x0A1C1A17); // ink @ ~4%
  static const Color shadowRing = Color(0x0D1C1A17); // ink @ ~5%
  static const Color shadowModal = Color(0x2E1C1A17); // ink @ ~18%
  static const Color accentGlow = Color(0x99D6483B); // accent @ ~60%
}
