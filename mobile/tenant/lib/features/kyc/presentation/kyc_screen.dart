import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../application/kyc_controller.dart';
import '../domain/kyc.dart';

/// KYC screen. Shows the server-owned status (Not submitted / Pending / Verified
/// / Rejected) and, when action is needed, the three-document upload form with
/// the rejection reason and re-upload. The app NEVER decides VERIFIED itself.
class KycScreen extends ConsumerStatefulWidget {
  const KycScreen({super.key});

  @override
  ConsumerState<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends ConsumerState<KycScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(kycControllerProvider.notifier).load());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(kycControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Identity verification')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: state.loading && state.view == null
            ? const Center(child: CircularProgressIndicator())
            : _body(context, state),
      ),
    );
  }

  Widget _body(BuildContext context, KycEditState state) {
    return switch (state.status) {
      KycStatus.verified => const _StatusCard(
          icon: Icons.verified_user,
          color: Colors.green,
          title: 'Identity verified',
          message: 'You can now pay the token and confirm bookings.',
        ),
      KycStatus.pending => const _StatusCard(
          icon: Icons.hourglass_bottom,
          color: Colors.orange,
          title: 'Under review',
          message: 'Your documents were submitted and are being reviewed. '
              "We'll update this status once an admin verifies them.",
        ),
      KycStatus.notSubmitted || KycStatus.rejected => _UploadForm(state: state),
    };
  }
}

class _UploadForm extends ConsumerWidget {
  const _UploadForm({required this.state});

  final KycEditState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controller = ref.read(kycControllerProvider.notifier);

    return ListView(
      children: [
        if (state.status == KycStatus.rejected) ...[
          _RejectionBanner(reason: state.rejectReason),
          const SizedBox(height: 16),
        ],
        const Text(
          'Upload your Aadhaar (front & back) and one supporting ID. '
          'Required only to pay — your documents are private and encrypted.',
        ),
        const SizedBox(height: 16),
        for (final slot in KycSlot.values)
          _SlotTile(
            slot: slot,
            uploaded: state.uploadedKeys.containsKey(slot),
            busy: state.uploading.contains(slot),
            onPick: (source) => controller.pickAndUpload(slot, source),
          ),
        const SizedBox(height: 8),
        DropdownButtonFormField<KycSupportingDocType>(
          initialValue: state.supportingType,
          decoration: const InputDecoration(labelText: 'Supporting ID type', border: OutlineInputBorder()),
          items: [
            for (final t in KycSupportingDocType.values)
              DropdownMenuItem(value: t, child: Text(t.label)),
          ],
          onChanged: (t) => t == null ? null : controller.setSupportingType(t),
        ),
        if (state.error != null) ...[
          const SizedBox(height: 16),
          Text(state.error!, style: const TextStyle(color: Colors.red)),
        ],
        const SizedBox(height: 24),
        FilledButton(
          onPressed: state.allUploaded && !state.submitting ? controller.submit : null,
          child: state.submitting
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Submit for review'),
        ),
      ],
    );
  }
}

class _SlotTile extends StatelessWidget {
  const _SlotTile({required this.slot, required this.uploaded, required this.busy, required this.onPick});

  final KycSlot slot;
  final bool uploaded;
  final bool busy;
  final void Function(ImageSource source) onPick;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(uploaded ? Icons.check_circle : Icons.upload_file,
            color: uploaded ? Colors.green : null),
        title: Text(slot.label),
        subtitle: Text(uploaded ? 'Uploaded' : 'Not uploaded'),
        trailing: busy
            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.photo_camera),
                    tooltip: 'Camera',
                    onPressed: () => onPick(ImageSource.camera),
                  ),
                  IconButton(
                    icon: const Icon(Icons.photo_library),
                    tooltip: 'Gallery',
                    onPressed: () => onPick(ImageSource.gallery),
                  ),
                ],
              ),
      ),
    );
  }
}

class _RejectionBanner extends StatelessWidget {
  const _RejectionBanner({this.reason});

  final String? reason;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.red.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.red.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, color: Colors.red),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Your KYC was rejected', style: TextStyle(fontWeight: FontWeight.w600)),
                if (reason != null && reason!.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(reason!),
                ],
                const SizedBox(height: 4),
                const Text('Please re-upload the documents below.'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.icon, required this.color, required this.title, required this.message});

  final IconData icon;
  final Color color;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: color, size: 64),
          const SizedBox(height: 16),
          Text(title, style: Theme.of(context).textTheme.titleLarge, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
