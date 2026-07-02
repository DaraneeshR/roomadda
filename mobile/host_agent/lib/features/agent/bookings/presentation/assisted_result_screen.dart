import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_widgets.dart';
import '../domain/agent_booking.dart';

/// Confirmation that an assisted-booking pay link was sent to the USER. Shows the
/// MASKED tenant phone + the link status (sent / paid / expired) and the token
/// amount — and NOTHING payable. There is no "pay" button anywhere: the agent
/// cannot pay on the user's behalf (the backend also 403s any such attempt). The
/// booking confirms only when the user pays and the verified webhook settles it.
class AssistedResultScreen extends StatelessWidget {
  const AssistedResultScreen({super.key, required this.result});
  final AssistedBookingResult result;

  @override
  Widget build(BuildContext context) {
    final status = result.linkStatus();
    return Scaffold(
      appBar: AppBar(title: const Text('Pay link sent')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
        children: [
          Center(
            child: Column(
              children: [
                const Icon(Icons.mark_email_read_outlined, size: 56, color: AppColors.agentHeroStart),
                const SizedBox(height: 12),
                Text('Link sent to the tenant', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 4),
                Text('They pay on their own device — you don’t collect anything.',
                    textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          const SizedBox(height: 24),
          AgentCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text('Status', style: AppTypography.eyebrow),
                    const Spacer(),
                    _statusPill(status),
                  ],
                ),
                const Divider(height: 24),
                AgentInfoRow(label: 'Sent to', value: result.payLinkSentTo),
                AgentInfoRow(label: 'Token amount', value: result.tokenAmount.format()),
                if (result.expiresAt != null)
                  AgentInfoRow(label: 'Link expires', value: DateFormat('d MMM, h:mm a').format(result.expiresAt!.toLocal())),
                AgentInfoRow(label: 'Booking', value: result.bookingId),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: const BoxDecoration(
              color: AppColors.paperAlt,
              borderRadius: AppRadii.cardBorder,
            ),
            child: const Row(
              children: [
                Icon(Icons.info_outline, size: 18, color: AppColors.mutedInk),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Payment status updates on your dashboard once the tenant pays. Nothing to do here — there is no pay step on your side.',
                    style: TextStyle(color: AppColors.mutedInk, fontSize: 13),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          PrimaryButton(label: 'Done', icon: Icons.check, expand: true, onPressed: () => Navigator.of(context).pop()),
        ],
      ),
    );
  }

  Widget _statusPill(LinkStatus status) => switch (status) {
        LinkStatus.paid => AgentPill(label: status.label, color: AppColors.verified),
        LinkStatus.expired => AgentPill(label: status.label, color: AppColors.error),
        LinkStatus.sent => AgentPill(label: status.label, color: AppColors.sponsored),
      };
}
