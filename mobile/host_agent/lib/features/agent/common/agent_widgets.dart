import 'package:flutter/material.dart';
import 'package:roomadda_core/roomadda_core.dart';

/// Agent-surface design primitives. Deliberately mirrors the host `host_widgets`
/// so the two role surfaces feel like one app, but lives under the agent feature
/// so it stays self-contained (a sibling feature never reaches into `host/`). The
/// agent surface reads on green accents (README "Agent green hero").

/// A small coloured status/label pill.
class AgentPill extends StatelessWidget {
  const AgentPill({super.key, required this.label, required this.color, this.filled = false});

  final String label;
  final Color color;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: filled ? color : color.withValues(alpha: 0.12),
        borderRadius: AppRadii.pillBorder,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: Text(
          label.toUpperCase(),
          style: TextStyle(
            color: filled ? AppColors.onAccent : color,
            fontWeight: FontWeight.w700,
            fontSize: 11,
          ),
        ),
      ),
    );
  }
}

/// A labelled metric tile (e.g. "Visits done · 12"). [accent] tints the value.
class AgentStatTile extends StatelessWidget {
  const AgentStatTile({
    super.key,
    required this.label,
    required this.value,
    this.sublabel,
    this.accent,
    this.icon,
  });

  final String label;
  final String value;
  final String? sublabel;
  final Color? accent;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: accent ?? AppColors.mutedInk),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(label.toUpperCase(),
                    style: AppTypography.eyebrow, maxLines: 1, overflow: TextOverflow.ellipsis),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: AppTypography.priceStyle(fontSize: 20, color: accent ?? AppColors.ink)),
          if (sublabel != null) ...[
            const SizedBox(height: 2),
            Text(sublabel!, style: text.bodySmall),
          ],
        ],
      ),
    );
  }
}

/// A flat label/value row used in detail cards.
class AgentInfoRow extends StatelessWidget {
  const AgentInfoRow({super.key, required this.label, required this.value, this.valueColor});

  final String label;
  final String value;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: const TextStyle(color: AppColors.mutedInk))),
          Expanded(
            child: Text(
              value,
              style: TextStyle(color: valueColor ?? AppColors.ink, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// A plain bordered card wrapper (optionally tappable).
class AgentCard extends StatelessWidget {
  const AgentCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap});

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final card = DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Padding(padding: padding, child: child),
    );
    if (onTap == null) return card;
    return Material(
      color: Colors.transparent,
      borderRadius: AppRadii.cardBorder,
      clipBehavior: Clip.antiAlias,
      child: InkWell(onTap: onTap, child: card),
    );
  }
}
