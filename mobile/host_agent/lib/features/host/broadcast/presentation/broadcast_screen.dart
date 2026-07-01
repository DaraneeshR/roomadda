import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_widgets.dart';
import '../application/broadcast_controller.dart';
import '../domain/broadcast.dart';

/// Compose + send a broadcast to a property's current tenants. The message is
/// capped at 280 chars and the property may send at most 3 per rolling 24h — both
/// enforced server-side; here we mirror the cap so the send button disables once
/// it's reached, and show a live preview before sending.
class BroadcastScreen extends ConsumerStatefulWidget {
  const BroadcastScreen({super.key, required this.listingId});
  final String listingId;

  @override
  ConsumerState<BroadcastScreen> createState() => _BroadcastScreenState();
}

class _BroadcastScreenState extends ConsumerState<BroadcastScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send(BroadcastState state) async {
    final body = _controller.text.trim();
    if (body.isEmpty) return;
    final ok = await ref.read(broadcastControllerProvider(widget.listingId).notifier).send(body);
    if (!mounted) return;
    if (ok) {
      final result = ref.read(broadcastControllerProvider(widget.listingId)).lastResult;
      _controller.clear();
      setState(() {});
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Sent to ${result?.recipientCount ?? 0} tenant(s)')),
      );
    } else {
      final err = ref.read(broadcastControllerProvider(widget.listingId)).error;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err ?? 'Could not send')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(broadcastControllerProvider(widget.listingId));
    final text = _controller.text.trim();
    final chars = _controller.text.characters.length;
    final canSend = state.canSend && text.isNotEmpty && chars <= broadcastMaxChars;

    return Scaffold(
      appBar: AppBar(title: const Text('Broadcast')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Message all current tenants',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              HostPill(
                label: '${state.remaining} of $broadcastDailyLimit left',
                color: state.capReached ? AppColors.accent : AppColors.verified,
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            maxLines: 4,
            maxLength: broadcastMaxChars,
            enabled: !state.capReached,
            buildCounter: (_, {required currentLength, required isFocused, maxLength}) =>
                Text('$currentLength / $maxLength', style: Theme.of(context).textTheme.bodySmall),
            inputFormatters: [LengthLimitingTextInputFormatter(broadcastMaxChars)],
            decoration: const InputDecoration(
              hintText: 'e.g. Water supply will be off tomorrow 10am–12pm for tank cleaning.',
            ),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 16),
          if (text.isNotEmpty) ...[
            Text('Preview', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            _PreviewBubble(text: text),
            const SizedBox(height: 16),
          ],
          if (state.capReached)
            const _CapNote()
          else
            const Text(
              'Ex-tenants never receive broadcasts. Each goes into the tenant’s chat thread.',
              style: TextStyle(color: AppColors.mutedInk, fontSize: 13),
            ),
          const SizedBox(height: 20),
          if (state.sending)
            const Center(child: CircularProgressIndicator())
          else
            PrimaryButton(
              label: 'Send broadcast',
              icon: Icons.campaign,
              expand: true,
              onPressed: canSend ? () => _send(state) : null,
            ),
        ],
      ),
    );
  }
}

class _PreviewBubble extends StatelessWidget {
  const _PreviewBubble({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: const BoxDecoration(color: AppColors.accentWash, borderRadius: AppRadii.cardBorder),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.campaign_outlined, size: 18, color: AppColors.accent),
          const SizedBox(width: 10),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

class _CapNote extends StatelessWidget {
  const _CapNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: const BoxDecoration(color: AppColors.accentWash, borderRadius: AppRadii.cardBorder),
      child: const Row(
        children: [
          Icon(Icons.block, size: 18, color: AppColors.accent),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'You’ve used today’s 3 broadcasts. Try again tomorrow.',
              style: TextStyle(color: AppColors.ink, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
