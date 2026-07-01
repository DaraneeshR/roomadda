import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../../common/host_async.dart';
import '../../common/host_widgets.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/listing_form_controller.dart';
import '../application/listing_providers.dart';
import '../data/host_listing_repository.dart';
import '../data/photo_picker.dart';
import '../domain/host_listing.dart';

/// Common amenities offered as quick-toggles in the create/edit form.
const _commonAmenities = <String>[
  'WiFi', 'AC', 'Hot water', 'Power backup', 'Laundry', 'Housekeeping',
  'Parking', 'CCTV', 'Lift', 'Refrigerator', 'TV', 'Study table',
];

/// The 7-step create/edit form. For create the route passes no id (a blank draft);
/// for edit the listing is loaded first and the form is seeded from it. The
/// min-5-photos rule and (in edit mode) the re-queue warning are enforced here.
class ListingFormScreen extends ConsumerWidget {
  const ListingFormScreen({super.key, this.listingId});

  /// Null = create; non-null = edit (load the listing, then seed the form).
  final String? listingId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (listingId == null) {
      return const _FormBody(original: null);
    }
    final async = ref.watch(hostListingProvider(listingId!));
    return Scaffold(
      appBar: AppBar(title: const Text('Edit listing')),
      body: HostAsync<HostListing>(
        value: async,
        onRetry: () => ref.invalidate(hostListingProvider(listingId!)),
        skeleton: const SkeletonList(count: 3, height: 120),
        data: (listing) => _FormBody(original: listing, embedded: true),
      ),
    );
  }
}

class _FormBody extends ConsumerStatefulWidget {
  const _FormBody({required this.original, this.embedded = false});
  final HostListing? original;

  /// True when already inside an edit Scaffold (don't double-wrap the AppBar).
  final bool embedded;

  @override
  ConsumerState<_FormBody> createState() => _FormBodyState();
}

class _FormBodyState extends ConsumerState<_FormBody> {
  late final ListingFormController _controller;
  late ListingFormState _state;
  late final VoidCallback _removeListener;
  int _step = 0;

  static const _stepTitles = <String>[
    'Basics', 'Rooms', 'Amenities', 'Meals', 'Rules', 'Photos', 'Booking',
  ];

  bool get isEdit => widget.original != null;

  @override
  void initState() {
    super.initState();
    _controller = ListingFormController(ref.read(hostListingRepositoryProvider), original: widget.original);
    var first = true;
    // addListener fires immediately (synchronously) here — seed `_state` without
    // setState on that first call, then rebuild on every subsequent change.
    _removeListener = _controller.addListener((s) {
      if (first) {
        _state = s;
        first = false;
      } else {
        setState(() => _state = s);
      }
    });
  }

  @override
  void dispose() {
    _removeListener();
    _controller.dispose();
    super.dispose();
  }

  void _next() {
    if (_step < _stepTitles.length - 1) setState(() => _step++);
  }

  void _back() {
    if (_step > 0) setState(() => _step--);
  }

  Future<void> _submit() async {
    if (isEdit) {
      final requeued = await _controller.submitEdit();
      if (requeued == null) {
        _snackError();
        return;
      }
      ref.invalidate(hostListingProvider(widget.original!.id));
      ref.invalidate(hostListingsProvider);
      ref.invalidate(hostDashboardProvider);
      if (!mounted) return;
      if (requeued) {
        await _showRequeuedDialog();
      }
      if (mounted) context.pop();
    } else {
      final id = await _controller.submitCreate();
      if (id == null) {
        _snackError();
        return;
      }
      ref.invalidate(hostListingsProvider);
      ref.invalidate(hostDashboardProvider);
      if (!mounted) return;
      // Replace the form with the new listing's hub.
      context.pushReplacement('/host/listings/$id');
    }
  }

  void _snackError() {
    final msg = _state.error ?? 'Something went wrong';
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _showRequeuedDialog() => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Sent for approval'),
          content: const Text(
            'Your address or pricing change re-queues this listing for approval. '
            'It stays visible until the team reviews the update.',
          ),
          actions: [TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('OK'))],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final body = Column(
      children: [
        _StepBar(step: _step, total: _stepTitles.length, title: _stepTitles[_step]),
        if (isEdit && _controller.editWouldRequeue) const _RequeueBanner(),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [_buildStep()],
          ),
        ),
        _NavBar(
          step: _step,
          total: _stepTitles.length,
          canSubmit: _state.canSubmit,
          submitting: _state.submitting,
          isEdit: isEdit,
          onBack: _back,
          onNext: _next,
          onSubmit: _submit,
        ),
      ],
    );
    if (widget.embedded) return SafeArea(top: false, child: body);
    return Scaffold(
      appBar: AppBar(title: const Text('New listing')),
      body: SafeArea(top: false, child: body),
    );
  }

  Widget _buildStep() => switch (_step) {
        0 => _BasicsStep(state: _state, controller: _controller),
        1 => _RoomsStep(state: _state, controller: _controller),
        2 => _AmenitiesStep(state: _state, controller: _controller),
        3 => _MealsStep(state: _state, controller: _controller),
        4 => _RulesStep(state: _state, controller: _controller),
        5 => _PhotosStep(state: _state, controller: _controller),
        _ => _BookingStep(state: _state, controller: _controller),
      };
}

// ── Chrome ──────────────────────────────────────────────────────────────────

class _StepBar extends StatelessWidget {
  const _StepBar({required this.step, required this.total, required this.title});
  final int step;
  final int total;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text('STEP ${step + 1} OF $total', style: AppTypography.eyebrow),
              const Spacer(),
              Text(title, style: Theme.of(context).textTheme.titleSmall),
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(
              value: (step + 1) / total,
              minHeight: 6,
              backgroundColor: AppColors.paperAlt,
              color: AppColors.accent,
            ),
          ),
        ],
      ),
    );
  }
}

class _RequeueBanner extends StatelessWidget {
  const _RequeueBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 12, 20, 0),
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(color: AppColors.sponsoredWash, borderRadius: AppRadii.cardBorder),
      child: const Row(
        children: [
          Icon(Icons.info_outline, color: AppColors.sponsored, size: 18),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Saving these changes will re-queue this listing for approval.',
              style: TextStyle(color: AppColors.ink, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _NavBar extends StatelessWidget {
  const _NavBar({
    required this.step,
    required this.total,
    required this.canSubmit,
    required this.submitting,
    required this.isEdit,
    required this.onBack,
    required this.onNext,
    required this.onSubmit,
  });

  final int step;
  final int total;
  final bool canSubmit;
  final bool submitting;
  final bool isEdit;
  final VoidCallback onBack;
  final VoidCallback onNext;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final isLast = step == total - 1;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
      child: Row(
        children: [
          if (step > 0)
            Expanded(child: SecondaryButton(label: 'Back', expand: true, onPressed: submitting ? null : onBack)),
          if (step > 0) const SizedBox(width: 12),
          Expanded(
            child: submitting
                ? const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))
                : isLast
                    ? PrimaryButton(
                        label: isEdit ? 'Save changes' : 'Create listing',
                        icon: Icons.check,
                        expand: true,
                        onPressed: canSubmit ? onSubmit : null,
                      )
                    : PrimaryButton(label: 'Next', icon: Icons.arrow_forward, expand: true, onPressed: onNext),
          ),
        ],
      ),
    );
  }
}

// ── Steps ───────────────────────────────────────────────────────────────────

class _BasicsStep extends StatelessWidget {
  const _BasicsStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Field(label: 'Public name (alias)', value: state.alias, onChanged: controller.setAlias),
        _Field(label: 'Actual PG name', value: state.actualName, onChanged: controller.setActualName),
        _Field(label: 'Area label', value: state.areaLabel, onChanged: controller.setAreaLabel),
        _Field(label: 'City', value: state.city, onChanged: controller.setCity),
        _Field(
          label: 'Pincode',
          value: state.pincode,
          keyboardType: TextInputType.number,
          onChanged: controller.setPincode,
        ),
        _Field(label: 'Full address', value: state.fullAddress, maxLines: 2, onChanged: controller.setFullAddress),
        const SizedBox(height: 8),
        Text('Map pin', style: AppTypography.eyebrow),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _Field(
                label: 'Latitude',
                value: state.lat?.toString() ?? '',
                keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                onChanged: (v) => controller.setPin(double.tryParse(v) ?? 0, state.lng ?? 0),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _Field(
                label: 'Longitude',
                value: state.lng?.toString() ?? '',
                keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                onChanged: (v) => controller.setPin(state.lat ?? 0, double.tryParse(v) ?? 0),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Text('Who is it for?', style: AppTypography.eyebrow),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: genderPolicies
              .map((g) => ChoiceChip(
                    label: Text(genderLabel(g)),
                    selected: state.gender == g,
                    onSelected: (_) => controller.setGender(g),
                  ))
              .toList(),
        ),
      ],
    );
  }
}

class _RoomsStep extends StatelessWidget {
  const _RoomsStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < state.rooms.length; i++)
          _RoomEditor(
            index: i,
            room: state.rooms[i],
            // Never remove an existing (already-created) room from the edit form.
            canRemove: state.rooms[i].roomId == null,
            onChanged: (r) => controller.updateRoom(i, r),
            onRemove: () => controller.removeRoom(i),
          ),
        const SizedBox(height: 8),
        SecondaryButton(label: 'Add room', icon: Icons.add, expand: true, onPressed: controller.addRoom),
        if (state.rooms.isEmpty)
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: Text('Add at least one room with pricing.', style: TextStyle(color: AppColors.mutedInk)),
          ),
      ],
    );
  }
}

class _RoomEditor extends StatelessWidget {
  const _RoomEditor({
    required this.index,
    required this.room,
    required this.canRemove,
    required this.onChanged,
    required this.onRemove,
  });

  final int index;
  final RoomDraft room;
  final bool canRemove;
  final ValueChanged<RoomDraft> onChanged;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: HostCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text('Room ${index + 1}', style: Theme.of(context).textTheme.titleSmall)),
                if (canRemove)
                  IconButton(
                    icon: const Icon(Icons.delete_outline, color: AppColors.accent),
                    onPressed: onRemove,
                  ),
              ],
            ),
            _Field(label: 'Room name', value: room.name, onChanged: (v) => onChanged(room.copyWith(name: v))),
            Row(
              children: [
                Expanded(
                  child: _Field(
                    label: 'Sharing (beds/room)',
                    value: room.sharingType.toString(),
                    keyboardType: TextInputType.number,
                    onChanged: (v) => onChanged(room.copyWith(sharingType: int.tryParse(v) ?? room.sharingType)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _Field(
                    label: 'Beds to add',
                    value: room.bedCount.toString(),
                    keyboardType: TextInputType.number,
                    onChanged: (v) => onChanged(room.copyWith(bedCount: int.tryParse(v) ?? room.bedCount)),
                  ),
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: _RupeeField(
                    label: 'Monthly rent',
                    paise: room.monthlyRentPaise,
                    onChanged: (p) => onChanged(room.copyWith(monthlyRentPaise: p)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _RupeeField(
                    label: 'Deposit',
                    paise: room.depositPaise,
                    onChanged: (p) => onChanged(room.copyWith(depositPaise: p)),
                  ),
                ),
              ],
            ),
            if (room.rentRequeues)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Rent change over 20% re-queues for approval.',
                  style: TextStyle(color: AppColors.sponsored, fontSize: 12),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _AmenitiesStep extends StatelessWidget {
  const _AmenitiesStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _commonAmenities
          .map((a) => FilterChip(
                label: Text(a),
                selected: state.amenities.contains(a),
                onSelected: (_) => controller.toggleAmenity(a),
              ))
          .toList(),
    );
  }
}

class _MealsStep extends StatelessWidget {
  const _MealsStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Meals offered'),
          value: state.mealsOffered,
          onChanged: controller.setMealsOffered,
        ),
        if (state.mealsOffered)
          _RupeeField(
            label: 'Monthly meal charges',
            paise: state.mealChargesPaise ?? 0,
            onChanged: (p) => controller.setMealCharges(p),
          ),
      ],
    );
  }
}

class _RulesStep extends StatefulWidget {
  const _RulesStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  State<_RulesStep> createState() => _RulesStepState();
}

class _RulesStepState extends State<_RulesStep> {
  final _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _add() {
    final v = _input.text.trim();
    if (v.isEmpty) return;
    widget.controller.setHouseRules([...widget.state.houseRules, v]);
    _input.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < widget.state.houseRules.length; i++)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.check_circle_outline, color: AppColors.verified),
            title: Text(widget.state.houseRules[i]),
            trailing: IconButton(
              icon: const Icon(Icons.close, color: AppColors.faintInk),
              onPressed: () =>
                  widget.controller.setHouseRules([...widget.state.houseRules]..removeAt(i)),
            ),
          ),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _input,
                decoration: const InputDecoration(hintText: 'Add a house rule'),
                onSubmitted: (_) => _add(),
              ),
            ),
            IconButton(icon: const Icon(Icons.add_circle, color: AppColors.accent), onPressed: _add),
          ],
        ),
      ],
    );
  }
}

class _PhotosStep extends ConsumerStatefulWidget {
  const _PhotosStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  ConsumerState<_PhotosStep> createState() => _PhotosStepState();
}

class _PhotosStepState extends ConsumerState<_PhotosStep> {
  bool _picking = false;

  /// Pick one photo from the camera/gallery and hand its bytes to the controller
  /// (held until submit, where it's uploaded to a presigned URL and attached).
  Future<void> _pick(ImageSource source) async {
    if (_picking) return;
    setState(() => _picking = true);
    try {
      final picked = await ref.read(listingPhotoPickerProvider).pick(source);
      if (picked != null) {
        widget.controller.addLocalPhoto(picked.bytes, picked.contentType);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not add that photo. Try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final photos = widget.state.photos;
    final ok = widget.state.photosValid;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text('Photos', style: Theme.of(context).textTheme.titleSmall),
            const Spacer(),
            HostPill(
              label: '${photos.length} / $minListingPhotos',
              color: ok ? AppColors.verified : AppColors.sponsored,
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          ok
              ? 'Looks good. Photos upload when you save the listing.'
              : 'Add at least $minListingPhotos photos from your phone to publish.',
          style: TextStyle(color: ok ? AppColors.verified : AppColors.mutedInk, fontSize: 13),
        ),
        const SizedBox(height: 12),
        if (photos.isNotEmpty)
          GridView.count(
            crossAxisCount: 3,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              for (var i = 0; i < photos.length; i++)
                _PhotoTile(
                  photo: photos[i],
                  isCover: i == 0,
                  onRemove: () => widget.controller.removePhoto(i),
                ),
            ],
          ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: SecondaryButton(
                label: 'Camera',
                icon: Icons.photo_camera_outlined,
                expand: true,
                onPressed: _picking ? null : () => _pick(ImageSource.camera),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: SecondaryButton(
                label: 'Gallery',
                icon: Icons.photo_library_outlined,
                expand: true,
                onPressed: _picking ? null : () => _pick(ImageSource.gallery),
              ),
            ),
          ],
        ),
        if (_picking)
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: Center(child: CircularProgressIndicator()),
          ),
      ],
    );
  }
}

/// One photo thumbnail in the grid: an on-device capture (Image.memory) or an
/// already-attached photo (Image.network), with a remove button and a cover tag.
class _PhotoTile extends StatelessWidget {
  const _PhotoTile({required this.photo, required this.isCover, required this.onRemove});

  final ListingPhotoDraft photo;
  final bool isCover;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (photo.isUploaded)
            Image.network(photo.url!, fit: BoxFit.cover)
          else
            Image.memory(photo.bytes!, fit: BoxFit.cover),
          Positioned(
            top: 2,
            right: 2,
            child: GestureDetector(
              onTap: onRemove,
              child: Container(
                decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                padding: const EdgeInsets.all(2),
                child: const Icon(Icons.close, size: 16, color: Colors.white),
              ),
            ),
          ),
          if (isCover)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                color: Colors.black54,
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: const Text(
                  'Cover',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white, fontSize: 11),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _BookingStep extends StatelessWidget {
  const _BookingStep({required this.state, required this.controller});
  final ListingFormState state;
  final ListingFormController controller;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _RupeeField(
          label: 'Token amount (to reserve a bed)',
          paise: state.tokenAmountPaise ?? 0,
          onChanged: (p) => controller.setToken(p == 0 ? null : p),
        ),
        const SizedBox(height: 12),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Instant book'),
          subtitle: const Text('Off = each booking needs your approval (24h)'),
          value: state.instantBook,
          onChanged: controller.setInstantBook,
        ),
        if (!state.tokenValid)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('A positive token amount is required.', style: TextStyle(color: AppColors.mutedInk)),
          ),
      ],
    );
  }
}

// ── Small inputs ──────────────────────────────────────────────────────────────

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.value,
    required this.onChanged,
    this.keyboardType,
    this.maxLines = 1,
  });

  final String label;
  final String value;
  final ValueChanged<String> onChanged;
  final TextInputType? keyboardType;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        initialValue: value,
        keyboardType: keyboardType,
        maxLines: maxLines,
        decoration: InputDecoration(labelText: label),
        onChanged: onChanged,
      ),
    );
  }
}

/// A rupee input that stores integer paise (rupees × 100 — never a float amount).
class _RupeeField extends StatelessWidget {
  const _RupeeField({required this.label, required this.paise, required this.onChanged});

  final String label;
  final int paise;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        initialValue: paise == 0 ? '' : (paise ~/ 100).toString(),
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(labelText: label, prefixText: '₹ '),
        onChanged: (v) => onChanged((int.tryParse(v) ?? 0) * 100),
      ),
    );
  }
}
