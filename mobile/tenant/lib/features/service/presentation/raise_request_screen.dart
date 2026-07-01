import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/service_providers.dart';
import '../data/service_repository.dart';
import '../domain/service_request.dart';

/// Raise a maintenance request: category, a required description, priority, and
/// up to 3 optional photos. On submit the photos upload to the private bucket
/// (presign + PUT, like KYC) and the ticket is created — the server requires an
/// active stay and returns a ticket number.
class RaiseRequestScreen extends ConsumerStatefulWidget {
  const RaiseRequestScreen({super.key});

  @override
  ConsumerState<RaiseRequestScreen> createState() => _RaiseRequestScreenState();
}

class _RaiseRequestScreenState extends ConsumerState<RaiseRequestScreen> {
  static const _maxPhotos = 3;

  final _formKey = GlobalKey<FormState>();
  final _description = TextEditingController();
  final _picker = ImagePicker();

  String _category = serviceCategories.first;
  String _priority = 'NORMAL';
  final List<XFile> _photos = [];
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    if (_photos.length >= _maxPhotos) return;
    final picked = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 70);
    if (picked != null && mounted) setState(() => _photos.add(picked));
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final messenger = ScaffoldMessenger.of(context);
    final router = GoRouter.of(context);
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final repo = ref.read(serviceRepositoryProvider);
      final refs = await _uploadPhotos(repo);
      final created = await repo.create(
        category: _category,
        description: _description.text.trim(),
        priority: _priority,
        photoRefs: refs,
      );
      ref.invalidate(serviceRequestsProvider);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text('Ticket ${created.ticketNumber} created')));
      router.pushReplacement('/tenant/service/${created.id}');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = apiExceptionFrom(e).message;
      });
    }
  }

  Future<List<String>> _uploadPhotos(ServiceRepository repo) async {
    final refs = <String>[];
    for (final photo in _photos) {
      final bytes = await photo.readAsBytes();
      final contentType = photo.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      final target = await repo.requestPhotoUrl(contentType);
      await repo.uploadBytes(target.uploadUrl, bytes, contentType);
      refs.add(target.key);
    }
    return refs;
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Scaffold(
      backgroundColor: AppColors.paper,
      appBar: AppBar(title: const Text('Raise a request')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text('CATEGORY', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _category,
              decoration: const InputDecoration(border: OutlineInputBorder()),
              items: [
                for (final c in serviceCategories)
                  DropdownMenuItem(value: c, child: Text(serviceCategoryLabel(c))),
              ],
              onChanged: _submitting ? null : (v) => setState(() => _category = v ?? _category),
            ),
            const SizedBox(height: 20),
            Text('DESCRIPTION', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            TextFormField(
              controller: _description,
              maxLines: 4,
              maxLength: 2000,
              enabled: !_submitting,
              decoration: const InputDecoration(
                hintText: 'Describe the issue (what, where, since when)…',
                border: OutlineInputBorder(),
              ),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Please describe the issue' : null,
            ),
            const SizedBox(height: 12),
            Text('PRIORITY', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'NORMAL', label: Text('Normal'), icon: Icon(Icons.schedule)),
                ButtonSegment(value: 'URGENT', label: Text('Urgent'), icon: Icon(Icons.priority_high)),
              ],
              selected: {_priority},
              onSelectionChanged: _submitting ? null : (s) => setState(() => _priority = s.first),
            ),
            const SizedBox(height: 20),
            Text('PHOTOS (OPTIONAL)', style: AppTypography.eyebrow),
            const SizedBox(height: 8),
            _PhotoRow(
              photos: _photos,
              max: _maxPhotos,
              enabled: !_submitting,
              onAdd: _addPhoto,
              onRemove: (i) => setState(() => _photos.removeAt(i)),
            ),
            const SizedBox(height: 24),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: AppColors.accent)),
              const SizedBox(height: 12),
            ],
            if (_submitting)
              const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))
            else
              PrimaryButton(label: 'Submit request', icon: Icons.send, expand: true, onPressed: _submit),
            const SizedBox(height: 8),
            Text(
              'You can comment on a request anytime; requests cannot be deleted.',
              style: text.bodySmall?.copyWith(color: AppColors.faintInk),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _PhotoRow extends StatelessWidget {
  const _PhotoRow({
    required this.photos,
    required this.max,
    required this.enabled,
    required this.onAdd,
    required this.onRemove,
  });

  final List<XFile> photos;
  final int max;
  final bool enabled;
  final VoidCallback onAdd;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 12,
      runSpacing: 12,
      children: [
        for (var i = 0; i < photos.length; i++)
          Stack(
            children: [
              ClipRRect(
                borderRadius: AppRadii.inputBorder,
                child: Image.file(File(photos[i].path), width: 76, height: 76, fit: BoxFit.cover),
              ),
              Positioned(
                top: -6,
                right: -6,
                child: IconButton(
                  icon: const Icon(Icons.cancel, color: AppColors.ink),
                  onPressed: enabled ? () => onRemove(i) : null,
                ),
              ),
            ],
          ),
        if (photos.length < max)
          InkWell(
            onTap: enabled ? onAdd : null,
            borderRadius: AppRadii.inputBorder,
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                borderRadius: AppRadii.inputBorder,
                border: Border.all(color: AppColors.hairlineStrong),
              ),
              child: const Icon(Icons.add_a_photo_outlined, color: AppColors.mutedInk),
            ),
          ),
      ],
    );
  }
}
