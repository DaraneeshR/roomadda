import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/safety_repository.dart';
import '../domain/trusted_contact.dart';

/// The SOS bottom sheet. Reached in ≤2 taps (dashboard SOS button → this), it
/// silently captures GPS and POSTs /v1/sos — the SERVER then SMSes every trusted
/// contact with the location AND alerts admin. SMS (not just push) is the
/// reliable channel; coordinates are best-effort (the alert still fires without).
enum _Stage { idle, sending, sent, error }

class SosSheet extends ConsumerStatefulWidget {
  const SosSheet({super.key, this.hostName, this.hostEmergencyNumber});

  final String? hostName;
  final String? hostEmergencyNumber;

  @override
  ConsumerState<SosSheet> createState() => _SosSheetState();
}

class _SosSheetState extends ConsumerState<SosSheet> {
  _Stage _stage = _Stage.idle;
  SosResult? _result;
  String? _error;

  /// Best-effort GPS fix. Returns null on denied permission / disabled service /
  /// timeout — the SOS still goes out (server marks location unavailable).
  Future<Position?> _position() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return null;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return null;
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 8)),
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> _sendSos() async {
    setState(() {
      _stage = _Stage.sending;
      _error = null;
    });
    try {
      final pos = await _position();
      final result = await ref.read(safetyRepositoryProvider).triggerSos(
            lat: pos?.latitude,
            lng: pos?.longitude,
          );
      if (!mounted) return;
      setState(() {
        _stage = _Stage.sent;
        _result = result;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _stage = _Stage.error;
        _error = apiExceptionFrom(e).message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.sos, color: AppColors.accent),
                const SizedBox(width: 8),
                Text('Emergency SOS', style: text.titleLarge),
              ],
            ),
            const SizedBox(height: 8),
            _body(text),
            const SizedBox(height: 16),
            if (widget.hostEmergencyNumber != null) _hostRow(text),
            TextButton.icon(
              onPressed: () {
                Navigator.of(context).pop();
                context.push('/tenant/trusted-contacts');
              },
              icon: const Icon(Icons.contacts_outlined, color: AppColors.mutedInk),
              label: const Text('Manage trusted contacts', style: TextStyle(color: AppColors.mutedInk)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body(TextTheme text) {
    switch (_stage) {
      case _Stage.idle:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'This alerts your trusted contacts and our team with your live location. '
              'In a real emergency also call 112.',
              style: text.bodyMedium?.copyWith(color: AppColors.mutedInk),
            ),
            const SizedBox(height: 16),
            PrimaryButton(label: 'Send SOS now', icon: Icons.sos, expand: true, onPressed: _sendSos),
          ],
        );
      case _Stage.sending:
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Row(
            children: [
              SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
              SizedBox(width: 14),
              Expanded(child: Text('Sharing your location and sending SOS…')),
            ],
          ),
        );
      case _Stage.sent:
        final n = _result?.contactsNotified ?? 0;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.check_circle, color: AppColors.verified),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    n > 0
                        ? 'SOS sent. $n trusted contact${n == 1 ? '' : 's'} and our team have been alerted.'
                        : 'SOS sent. Our team has been alerted.',
                    style: text.bodyLarge,
                  ),
                ),
              ],
            ),
            if (n == 0) ...[
              const SizedBox(height: 8),
              Text(
                'Add trusted contacts so they get alerted next time.',
                style: text.bodySmall?.copyWith(color: AppColors.mutedInk),
              ),
            ],
          ],
        );
      case _Stage.error:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(_error ?? 'Could not send SOS.', style: const TextStyle(color: AppColors.accent)),
            const SizedBox(height: 12),
            PrimaryButton(label: 'Try again', icon: Icons.refresh, expand: true, onPressed: _sendSos),
          ],
        );
    }
  }

  Widget _hostRow(TextTheme text) {
    final number = widget.hostEmergencyNumber!;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: DecoratedBox(
        decoration: const BoxDecoration(color: AppColors.accentWash, borderRadius: AppRadii.inputBorder),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.hostName ?? 'Your host', style: text.titleSmall),
                    const SizedBox(height: 2),
                    Text(number, style: AppTypography.priceStyle(fontSize: 15)),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.copy, color: AppColors.accent),
                tooltip: 'Copy host number',
                onPressed: () async {
                  final messenger = ScaffoldMessenger.of(context);
                  await Clipboard.setData(ClipboardData(text: number));
                  if (mounted) {
                    messenger.showSnackBar(const SnackBar(content: Text('Host number copied')));
                  }
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}
