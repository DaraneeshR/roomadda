import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/safety_providers.dart';
import '../data/safety_repository.dart';
import '../domain/trusted_contact.dart';

/// Manage trusted contacts (1–3). These are SMSed your location on SOS.
class TrustedContactsScreen extends ConsumerWidget {
  const TrustedContactsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(trustedContactsProvider);
    final text = Theme.of(context).textTheme;

    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Trusted contacts')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(apiExceptionFrom(e).message)),
        data: (view) => ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              'These people are texted your live location when you trigger SOS. Add up to ${view.max}.',
              style: text.bodyMedium?.copyWith(color: AppColors.mutedInk),
            ),
            const SizedBox(height: 16),
            if (view.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text('No trusted contacts yet.', textAlign: TextAlign.center, style: text.bodyMedium),
              )
            else
              for (final c in view.items) _ContactTile(contact: c),
            const SizedBox(height: 12),
            if (view.isFull)
              Text('You\'ve added the maximum of ${view.max} contacts.',
                  style: text.bodySmall?.copyWith(color: AppColors.faintInk), textAlign: TextAlign.center)
            else
              PrimaryButton(
                label: 'Add a contact',
                icon: Icons.person_add_alt,
                expand: true,
                onPressed: () => _showAddSheet(context, ref),
              ),
          ],
        ),
      ),
    );
  }
}

Future<void> _showAddSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.card,
    shape: const RoundedRectangleBorder(borderRadius: AppRadii.sheetBorder),
    builder: (_) => const _AddContactSheet(),
  );
}

class _ContactTile extends ConsumerWidget {
  const _ContactTile({required this.contact});

  final TrustedContact contact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: AppRadii.cardBorder,
          border: Border.all(color: AppColors.hairline),
        ),
        child: ListTile(
          leading: const CircleAvatar(backgroundColor: AppColors.accentWash, child: Icon(Icons.person, color: AppColors.accent)),
          title: Text(contact.name, style: text.titleSmall),
          subtitle: Text(contact.phone, style: AppTypography.priceStyle(fontSize: 13, color: AppColors.mutedInk)),
          trailing: IconButton(
            icon: const Icon(Icons.delete_outline, color: AppColors.mutedInk),
            tooltip: 'Remove',
            onPressed: () async {
              final messenger = ScaffoldMessenger.of(context);
              try {
                await ref.read(safetyRepositoryProvider).removeContact(contact.id);
                ref.invalidate(trustedContactsProvider);
              } catch (e) {
                messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
              }
            },
          ),
        ),
      ),
    );
  }
}

class _AddContactSheet extends ConsumerStatefulWidget {
  const _AddContactSheet();

  @override
  ConsumerState<_AddContactSheet> createState() => _AddContactSheetState();
}

class _AddContactSheetState extends ConsumerState<_AddContactSheet> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController(text: '+91');
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(safetyRepositoryProvider).addContact(name: _name.text.trim(), phone: _phone.text.trim());
      ref.invalidate(trustedContactsProvider);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = apiExceptionFrom(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottomInset),
      child: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Add a trusted contact', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextFormField(
              controller: _name,
              enabled: !_saving,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter a name' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              enabled: !_saving,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone (e.g. +9198…)', border: OutlineInputBorder()),
              validator: (v) =>
                  (v == null || !RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(v.trim())) ? 'Enter a valid phone with country code' : null,
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppColors.accent)),
              const SizedBox(height: 12),
            ],
            if (_saving)
              const Center(child: CircularProgressIndicator())
            else
              PrimaryButton(label: 'Save contact', expand: true, onPressed: _save),
          ],
        ),
      ),
    );
  }
}
