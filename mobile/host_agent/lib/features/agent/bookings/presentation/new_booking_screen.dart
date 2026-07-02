import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/agent_async.dart';
import '../../common/agent_widgets.dart';
import '../application/booking_providers.dart';
import '../data/agent_booking_repository.dart';
import '../domain/booking_room.dart';
import 'assisted_result_screen.dart';
import 'walk_in_qr_screen.dart';

/// The Bookings tab: convert a walk-in tenant at an in-zone property. The agent
/// enters the tenant's name + mobile + room + move-in and chooses a channel — the
/// USER always pays on their OWN device (assisted = SMS/WhatsApp link; walk-in =
/// scans a QR). There is NO pay action anywhere here (mirrors the server 403).
class NewBookingScreen extends ConsumerStatefulWidget {
  const NewBookingScreen({super.key});

  @override
  ConsumerState<NewBookingScreen> createState() => _NewBookingScreenState();
}

class _NewBookingScreenState extends ConsumerState<NewBookingScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  String? _listingId;
  String? _roomId;
  DateTime? _moveIn;
  bool _submitting = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  bool get _valid =>
      _listingId != null &&
      _roomId != null &&
      _name.text.trim().isNotEmpty &&
      _phone.text.trim().length >= 10 &&
      _moveIn != null;

  @override
  Widget build(BuildContext context) {
    final properties = ref.watch(agentBookingPropertiesProvider);
    return AgentAsync(
      value: properties,
      onRetry: () => ref.invalidate(agentBookingPropertiesProvider),
      skeleton: const SkeletonList(count: 3, height: 88),
      data: (props) {
        if (props.isEmpty) {
          return const AgentEmpty(
            icon: Icons.apartment_outlined,
            message: 'No assigned properties yet. Bookings are created at a property you’re assigned to.',
          );
        }
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            const _NoPayNotice(),
            const SizedBox(height: 16),
            AgentCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Property', style: AppTypography.eyebrow),
                  const SizedBox(height: 6),
                  DropdownButtonFormField<String>(
                    initialValue: _listingId,
                    isExpanded: true,
                    decoration: const InputDecoration(hintText: 'Select a property'),
                    items: [
                      for (final p in props)
                        DropdownMenuItem(value: p.listingId, child: Text('${p.actualName} · ${p.areaLabel}', overflow: TextOverflow.ellipsis)),
                    ],
                    onChanged: (v) => setState(() {
                      _listingId = v;
                      _roomId = null; // rooms depend on the property
                    }),
                  ),
                  const SizedBox(height: 12),
                  if (_listingId != null) _RoomPicker(
                    listingId: _listingId!,
                    selected: _roomId,
                    onChanged: (v) => setState(() => _roomId = v),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            AgentCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Tenant', style: AppTypography.eyebrow),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'Full name'),
                    onChanged: (_) => setState(() {}),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Mobile', hintText: '+91XXXXXXXXXX'),
                    onChanged: (_) => setState(() {}),
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
                ],
              ),
            ),
            const SizedBox(height: 20),
            if (_submitting)
              const Center(child: CircularProgressIndicator())
            else ...[
              PrimaryButton(
                label: 'Send pay link to tenant',
                icon: Icons.sms,
                expand: true,
                onPressed: _valid ? _submitAssisted : null,
              ),
              const SizedBox(height: 10),
              SecondaryButton(
                label: 'Walk-in — show pay QR',
                icon: Icons.qr_code_2,
                expand: true,
                onPressed: _valid ? _submitWalkIn : null,
              ),
            ],
          ],
        );
      },
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
    );
    if (picked != null) setState(() => _moveIn = picked);
  }

  /// Best-effort E.164 for India; the backend validates strictly.
  String _normalizePhone(String raw) {
    if (raw.startsWith('+')) return raw;
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    return digits.length == 10 ? '+91$digits' : '+$digits';
  }

  Future<void> _submitAssisted() async {
    if (!_valid) return;
    setState(() => _submitting = true);
    try {
      final result = await ref.read(agentBookingRepositoryProvider).createAssisted(
            tenantName: _name.text.trim(),
            tenantPhone: _normalizePhone(_phone.text.trim()),
            roomId: _roomId,
            moveInDate: _moveIn,
          );
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => AssistedResultScreen(result: result)));
      _reset();
    } catch (e) {
      _fail(e);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _submitWalkIn() async {
    if (!_valid) return;
    setState(() => _submitting = true);
    try {
      final result = await ref.read(agentBookingRepositoryProvider).createWalkIn(
            tenantName: _name.text.trim(),
            tenantPhone: _normalizePhone(_phone.text.trim()),
            roomId: _roomId,
            moveInDate: _moveIn,
          );
      if (!mounted) return;
      // The QR screen polls THIS booking's own status to CONFIRMED (webhook-driven).
      await Navigator.of(context).push(MaterialPageRoute(builder: (_) => WalkInQrScreen(result: result)));
      _reset();
    } catch (e) {
      _fail(e);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _fail(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
  }

  void _reset() {
    if (!mounted) return;
    setState(() {
      _name.clear();
      _phone.clear();
      _roomId = null;
      _moveIn = null;
    });
  }
}

class _RoomPicker extends ConsumerWidget {
  const _RoomPicker({required this.listingId, required this.selected, required this.onChanged});
  final String listingId;
  final String? selected;
  final ValueChanged<String?> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rooms = ref.watch(agentBookingRoomsProvider(listingId));
    return rooms.when(
      loading: () => const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: LinearProgressIndicator()),
      error: (e, _) => Text(apiExceptionFrom(e).message, style: const TextStyle(color: AppColors.error)),
      data: (list) {
        final bookable = list.where((r) => r.hasVacancy).toList();
        if (bookable.isEmpty) {
          return const Text('No rooms with a free bed at this property.',
              style: TextStyle(color: AppColors.mutedInk));
        }
        return DropdownButtonFormField<String>(
          initialValue: selected,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Room'),
          items: [
            for (final r in bookable)
              DropdownMenuItem(value: r.id, child: Text(_roomLabel(r), overflow: TextOverflow.ellipsis)),
          ],
          onChanged: onChanged,
        );
      },
    );
  }

  String _roomLabel(BookingRoom r) {
    final sharing = r.sharingType == null ? '' : ' · ${r.sharingType}';
    return '${r.name}$sharing · ${r.monthlyRent.format()} · ${r.availableBeds} free';
  }
}

class _NoPayNotice extends StatelessWidget {
  const _NoPayNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.agentVisitedWash,
        borderRadius: AppRadii.cardBorder,
        border: Border.all(color: AppColors.agentVisited.withValues(alpha: 0.25)),
      ),
      child: const Row(
        children: [
          Icon(Icons.shield_outlined, size: 18, color: AppColors.agentVisited),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'You never collect payment. The tenant pays on their own device; the booking confirms automatically once paid.',
              style: TextStyle(color: AppColors.agentVisited, fontSize: 13, fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
