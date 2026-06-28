import 'package:flutter/material.dart';
import 'package:roomadda_core/roomadda_core.dart';

/// A listing cover photo with a branded gradient fallback (README: "never a grey
/// box"). Used wherever a masked listing's photo is shown.
class CoverImage extends StatelessWidget {
  const CoverImage({super.key, this.url, this.fit = BoxFit.cover});

  final String? url;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) return const _GradientFallback();
    return Image.network(
      url!,
      fit: fit,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : const _GradientFallback(),
      errorBuilder: (_, __, ___) => const _GradientFallback(),
    );
  }
}

class _GradientFallback extends StatelessWidget {
  const _GradientFallback();

  @override
  Widget build(BuildContext context) {
    return const DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.accentWash, AppColors.paperAlt],
        ),
      ),
      child: Center(child: Icon(Icons.apartment, size: 32, color: AppColors.faintInk)),
    );
  }
}
