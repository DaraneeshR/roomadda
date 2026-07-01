import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../listings/application/listing_providers.dart';
import '../../listings/domain/host_listing.dart';
import '../application/walk_in_providers.dart';
import '../data/walk_in_repository.dart';
import '../domain/walk_in_tenant.dart';

/// Walk-in entry + current walk-ins. Recording one BLOCKS a bed (reduces
/// availability) and fires the app-invite SMS server-side. The payment mode is
/// recorded only — money is NOT processed in-app. The typed Aadhaar is sent to the
/// server (stored for the host's record) and only its last 4 digits ever return.
class WalkInScreen extends ConsumerWidget {
  const WalkInScreen({super.key, required this.listingId});
  final String listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(walkInsProvider(listingId));
    return Scaffold(
      appBar: AppBar(title: const Text('Walk-ins')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(context, ref),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Record walk-in'),
      ),
      body: HostAsync<WalkInPage>(
        value: async,
        onRetry: () => ref.invalidate(walkInsProvider(listingId)),
        skeleton: const SkeletonList(),
        data: (page) {
          if (page.items.isEmpty) {
            return const HostEmpty(
              icon: Icons.person_outline,
              message: 'No walk-ins recorded. Tap “Record walk-in” to add an off-platform tenant.',
            );
          }
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(walkInsProvider(listingId)),
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 96),
              itemCount: page.items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _WalkInTile(listingId: listingId, walkIn: page.items[i]),
            ),
          );
        },
      ),
    );
  }

  Future<void> _openForm(BuildContext context, WidgetRef ref) async {
    final HostListing listing;
    try {
      listing = await ref.read(hostListingProvider(listingId).future);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
      return;
    }
    if (!context.mounted) return;
    if (listing.rooms.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Add a room first.')));
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.paper,
      shape: const RoundedRectangleBorder(borderRadius: AppRadii.sheetBorder),
      builder: (_) => _WalkInForm(listingId: listingId, rooms: listing.rooms),
    );
  }
}

class _WalkInTile extends ConsumerWidget {
  const _WalkInTile({required this.listingId, required this.walkIn});
  final String listingId;
  final WalkInTenant walkIn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final text = Theme.of(context).textTheme;
    return HostCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(walkIn.name, style: text.titleMedium)),
              if (walkIn.invited)
                const HostPill(label: 'Invited', color: AppColors.verified)
              else
                const HostPill(label: 'Not invited', color: AppColors.sponsored),
            ],
          ),
          const SizedBox(height: 6),
          InfoRow(label: 'Room', value: walkIn.roomName),
          InfoRow(label: 'Aadhaar', value: '•••• •••• ${walkIn.aadhaarLast4}'),
          InfoRow(label: 'Move-in', value: DateFormat.yMMMd().format(walkIn.moveInDate)),
          InfoRow(label: 'Rent', value: '${walkIn.monthlyRent.format()} · ${paymentModeLabel(walkIn.paymentMode)}'),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: SecondaryButton(
              label: 'Check out',
              icon: Icons.logout,
              onPressed: () => _checkout(context, ref),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _checkout(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(walkInRepositoryProvider).checkout(walkIn.id);
      ref.invalidate(walkInsProvider(listingId));
      ref.invalidate(hostListingProvider(listingId));
      ref.invalidate(hostDashboardProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Checked out — bed freed')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
    }
  }
}

class _WalkInForm extends ConsumerStatefulWidget {
  const _WalkInForm({required this.listingId, required this.rooms});
  final String listingId;
  final List<HostRoomInventory> rooms;

  @override
  ConsumerState<_WalkInForm> createState() => _WalkInFormState();
}

class _WalkInFormState extends ConsumerState<_WalkInForm> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _aadhaar = TextEditingController();
  final _rent = TextEditingController();
  final _deposit = TextEditingController();
  String? _roomId;
  DateTime? _moveIn;
  String _paymentMode = 'CASH';
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _roomId = widget.rooms.first.roomId;
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _aadhaar.dispose();
    _rent.dispose();
    _deposit.dispose();
    super.dispose();
  }

  bool get _valid =>
      _name.text.trim().isNotEmpty &&
      _phone.text.trim().length >= 10 &&
      _aadhaar.text.trim().length == 12 &&
      _roomId != null &&
      _moveIn != null &&
      (int.tryParse(_rent.text) ?? 0) > 0;

  Future<void> _submit() async {
    if (!_valid) return;
    setState(() => _submitting = true);
    try {
      await ref.read(walkInRepositoryProvider).create(widget.listingId, {
        'roomId': _roomId,
        'name': _name.text.trim(),
        'phone': _normalizePhone(_phone.text.trim()),
        'aadhaarNumber': _aadhaar.text.trim(),
        'moveInDate': DateTime.utc(_moveIn!.year, _moveIn!.month, _moveIn!.day).toIso8601String(),
        'monthlyRentPaise': (int.tryParse(_rent.text) ?? 0) * 100,
        'depositPaise': (int.tryParse(_deposit.text) ?? 0) * 100,
        'paymentMode': _paymentMode,
      });
      ref.invalidate(walkInsProvider(widget.listingId));
      ref.invalidate(hostListingProvider(widget.listingId));
      ref.invalidate(hostDashboardProvider);
      if (mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Walk-in recorded — invite SMS sent')));
      }
    } catch (e) {
      if (mounted) {
        setState(() => _submitting = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
      }
    }
  }

  /// Best-effort E.164 for India; the backend validates strictly.
  String _normalizePhone(String raw) {
    if (raw.startsWith('+')) return raw;
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    return digits.length == 10 ? '+91$digits' : '+$digits';
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 30)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _moveIn = picked);
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 16, 20, 16 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: const BoxDecoration(color: AppColors.hairlineStrong, borderRadius: AppRadii.pillBorder),
              ),
            ),
            const SizedBox(height: 16),
            Text('Record walk-in', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextField(controller: _name, decoration: const InputDecoration(labelText: 'Tenant name'), onChanged: (_) => setState(() {})),
            const SizedBox(height: 12),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile', hintText: '+91XXXXXXXXXX'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _aadhaar,
              keyboardType: TextInputType.number,
              maxLength: 12,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(labelText: 'Aadhaar number (12 digits)'),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 4),
            DropdownButtonFormField<String>(
              initialValue: _roomId,
              decoration: const InputDecoration(labelText: 'Room'),
              items: widget.rooms
                  .map((r) => DropdownMenuItem(value: r.roomId, child: Text('${r.name} (${r.availableBeds} free)')))
                  .toList(),
              onChanged: (v) => setState(() => _roomId = v),
            ),
            const SizedBox(height: 12),
            InkWell(
              onTap: _pickDate,
              child: InputDecorator(
                decoration: const InputDecoration(labelText: 'Move-in date'),
                child: Text(
                  _moveIn == null ? 'Select a date' : DateFormat.yMMMd().format(_moveIn!),
                  style: TextStyle(color: _moveIn == null ? AppColors.faintInk : AppColors.ink),
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _rent,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(labelText: 'Monthly rent', prefixText: '₹ '),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _deposit,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(labelText: 'Deposit', prefixText: '₹ '),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('Payment mode (recorded, not charged)', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: walkInPaymentModes
                  .map((m) => ChoiceChip(
                        label: Text(paymentModeLabel(m)),
                        selected: _paymentMode == m,
                        onSelected: (_) => setState(() => _paymentMode = m),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 20),
            if (_submitting)
              const Center(child: CircularProgressIndicator())
            else
              PrimaryButton(label: 'Record walk-in', icon: Icons.check, expand: true, onPressed: _valid ? _submit : null),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
