import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../money/paise.dart';
import '../theme/app_colors.dart';
import '../theme/app_radii.dart';
import '../theme/app_shadows.dart';
import '../theme/app_theme.dart';
import '../theme/app_typography.dart';
import '../widgets/widgets.dart';

/// Dev-only design-system catalog. Run it in isolation with:
///
///   flutter run -t lib/dev/theme_catalog.dart
///
/// It is a separate entrypoint, so it never ships in the normal app build
/// (which targets lib/main.dart) — that is the "debug-only" fence. Nothing in
/// the production widget graph imports this file.
void main() {
  assert(kDebugMode, 'theme_catalog is a debug-only tool');
  runApp(const _CatalogApp());
}

class _CatalogApp extends StatelessWidget {
  const _CatalogApp();

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'RoomAdda — Theme Catalog',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light,
        home: const ThemeCatalogScreen(),
      );
}

/// Renders every design token and core widget so the system is eyeball-checkable
/// against design/README.md without booting the real app.
class ThemeCatalogScreen extends StatelessWidget {
  const ThemeCatalogScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Theme catalog')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 48),
        children: [
          const _Brand(),
          const SizedBox(height: 28),
          _section(
            context,
            'Color',
            'Tokens',
            const _Colors(),
          ),
          _section(
            context,
            'Typography',
            'Type scale',
            const _Typography(),
          ),
          _section(
            context,
            'Radius',
            'Corner radii',
            const _Radii(),
          ),
          _section(
            context,
            'Elevation',
            'Shadows',
            const _Shadows(),
          ),
          _section(
            context,
            'Components',
            'Buttons',
            const _Buttons(),
          ),
          _section(
            context,
            'Components',
            'Trust tags',
            const _TrustTags(),
          ),
          _section(
            context,
            'Components',
            'Price text',
            const _Prices(),
          ),
          _section(
            context,
            'Components',
            'Section header',
            const SectionHeader(
              eyebrow: 'Near you',
              title: 'PGs in Koramangala',
            ),
          ),
          _section(
            context,
            'Components',
            'Listing card',
            const _ListingCardDemo(),
          ),
        ],
      ),
    );
  }

  Widget _section(BuildContext context, String eyebrow, String title, Widget child) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SectionHeader(eyebrow: eyebrow, title: title),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

/// The wordmark — "RoomAdda" + a red period — over the mono tagline.
class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) {
    final wordmark = Theme.of(context).textTheme.displaySmall;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(
            children: [
              TextSpan(text: 'RoomAdda', style: wordmark),
              TextSpan(text: '.', style: wordmark?.copyWith(color: AppColors.accent)),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Text('STAY · GROW · BELONG', style: AppTypography.tagline),
      ],
    );
  }
}

class _Colors extends StatelessWidget {
  const _Colors();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 14,
      runSpacing: 14,
      children: [
        _Swatch('ink', AppColors.ink),
        _Swatch('paper', AppColors.paper),
        _Swatch('paperAlt', AppColors.paperAlt),
        _Swatch('card', AppColors.card),
        _Swatch('mutedInk', AppColors.mutedInk),
        _Swatch('faintInk', AppColors.faintInk),
        _Swatch('onInk', AppColors.onInk),
        _Swatch('accent', AppColors.accent),
        _Swatch('accentWash', AppColors.accentWash),
        _Swatch('verified', AppColors.verified),
        _Swatch('verifiedWash', AppColors.verifiedWash),
        _Swatch('agentVisited', AppColors.agentVisited),
        _Swatch('agentVisitedWash', AppColors.agentVisitedWash),
        _Swatch('sponsored', AppColors.sponsored),
        _Swatch('sponsoredWash', AppColors.sponsoredWash),
        _Swatch('error (=accent)', AppColors.error),
        _Swatch('hairline', AppColors.hairline),
        _Swatch('hairlineStrong', AppColors.hairlineStrong),
        _Swatch(
          'agentHero',
          AppColors.agentHeroStart,
          gradient: LinearGradient(
            colors: [AppColors.agentHeroStart, AppColors.agentHeroEnd],
          ),
        ),
      ],
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch(this.name, this.color, {this.gradient});

  final String name;
  final Color color;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 76,
          height: 48,
          decoration: BoxDecoration(
            color: gradient == null ? color : null,
            gradient: gradient,
            borderRadius: AppRadii.inputBorder,
            border: Border.all(color: AppColors.hairline),
          ),
        ),
        const SizedBox(height: 6),
        SizedBox(
          width: 84,
          child: Text(name, style: Theme.of(context).textTheme.labelSmall),
        ),
      ],
    );
  }
}

class _Typography extends StatelessWidget {
  const _Typography();

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _type(context, 'displayLarge', t.displayLarge),
        _type(context, 'displayMedium', t.displayMedium),
        _type(context, 'displaySmall', t.displaySmall),
        _type(context, 'headlineLarge', t.headlineLarge),
        _type(context, 'headlineMedium', t.headlineMedium),
        _type(context, 'headlineSmall', t.headlineSmall),
        _type(context, 'titleLarge', t.titleLarge),
        _type(context, 'titleMedium', t.titleMedium),
        _type(context, 'titleSmall', t.titleSmall),
        _type(context, 'bodyLarge', t.bodyLarge),
        _type(context, 'bodyMedium', t.bodyMedium),
        _type(context, 'bodySmall', t.bodySmall),
        _type(context, 'labelLarge', t.labelLarge),
        _type(context, 'labelMedium', t.labelMedium),
        _type(context, 'labelSmall', t.labelSmall),
        const Divider(height: 24),
        Text('eyebrow · mono', style: AppTypography.eyebrow),
        const SizedBox(height: 8),
        Text('STAY · GROW · BELONG', style: AppTypography.tagline),
        const SizedBox(height: 8),
        Text('Button label', style: AppTypography.button),
      ],
    );
  }

  Widget _type(BuildContext context, String name, TextStyle? style) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(name, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.faintInk)),
          Text('RoomAdda', style: style, maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

class _Radii extends StatelessWidget {
  const _Radii();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 16,
      runSpacing: 16,
      children: [
        _RadiusBox('pill', AppRadii.pill),
        _RadiusBox('input', AppRadii.input),
        _RadiusBox('card', AppRadii.card),
        _RadiusBox('sheet', AppRadii.sheet),
      ],
    );
  }
}

class _RadiusBox extends StatelessWidget {
  const _RadiusBox(this.name, this.radius);

  final String name;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 88,
          height: 56,
          decoration: BoxDecoration(
            color: AppColors.paperAlt,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: AppColors.hairlineStrong),
          ),
        ),
        const SizedBox(height: 6),
        Text('$name · $radius', style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

class _Shadows extends StatelessWidget {
  const _Shadows();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 20,
      runSpacing: 20,
      children: [
        _ShadowBox('card', AppShadows.card),
        _ShadowBox('modal', AppShadows.modal),
        _ShadowBox('ctaGlow', AppShadows.ctaGlow, tint: true),
      ],
    );
  }
}

class _ShadowBox extends StatelessWidget {
  const _ShadowBox(this.name, this.shadow, {this.tint = false});

  final String name;
  final List<BoxShadow> shadow;
  final bool tint;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 96,
          height: 64,
          decoration: BoxDecoration(
            color: tint ? AppColors.accent : AppColors.card,
            borderRadius: AppRadii.cardBorder,
            boxShadow: shadow,
          ),
        ),
        const SizedBox(height: 10),
        Text(name, style: Theme.of(context).textTheme.labelSmall),
      ],
    );
  }
}

class _Buttons extends StatelessWidget {
  const _Buttons();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            PrimaryButton(label: 'Pay token', onPressed: () {}),
            PrimaryButton(label: 'With icon', icon: Icons.lock_outline, onPressed: () {}),
            const PrimaryButton(label: 'Disabled'),
            SecondaryButton(label: 'Add to wishlist', icon: Icons.favorite_border, onPressed: () {}),
            const SecondaryButton(label: 'Disabled'),
          ],
        ),
        const SizedBox(height: 16),
        PrimaryButton(label: 'Full-width CTA', icon: Icons.arrow_forward, expand: true, onPressed: () {}),
      ],
    );
  }
}

class _TrustTags extends StatelessWidget {
  const _TrustTags();

  @override
  Widget build(BuildContext context) {
    return const Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        TrustTag(variant: TrustTagVariant.verified),
        TrustTag(variant: TrustTagVariant.agentVisited),
        TrustTag(variant: TrustTagVariant.sponsored),
      ],
    );
  }
}

class _Prices extends StatelessWidget {
  const _Prices();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PriceText(Paise(300000)),
        SizedBox(height: 8),
        PriceText(Paise(1250000), fontSize: 28, color: AppColors.accent),
      ],
    );
  }
}

class _ListingCardDemo extends StatelessWidget {
  const _ListingCardDemo();

  @override
  Widget build(BuildContext context) {
    return ListingCard(
      onTap: () {},
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              TrustTag(variant: TrustTagVariant.verified),
              TrustTag(variant: TrustTagVariant.agentVisited),
            ],
          ),
          const SizedBox(height: 10),
          Text('Sunrise Residency', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('Koramangala, Bengaluru', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 12),
          const Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              PriceText(Paise(1200000), color: AppColors.accent),
              SizedBox(width: 4),
              Text('/mo', style: TextStyle(color: AppColors.mutedInk)),
            ],
          ),
        ],
      ),
    );
  }
}
