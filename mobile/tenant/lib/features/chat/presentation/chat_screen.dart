import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../application/chat_controller.dart';
import '../domain/chat.dart';

/// Tenant chat with their current host. Lives in the dashboard's Chat tab (no
/// Scaffold of its own). Near-real-time via polling; the composer supports text
/// and photos; long-press a message to report it. Phone numbers are rejected
/// server-side, so the input is the platform-safe channel.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _input = TextEditingController();
  final _picker = ImagePicker();
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(chatControllerProvider.notifier).load();
      // Poll for new messages (Firestore listener replaces this in production).
      _poll = Timer.periodic(const Duration(seconds: 5), (_) {
        ref.read(chatControllerProvider.notifier).refresh();
      });
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _input.text;
    if (text.trim().isEmpty) return;
    _input.clear();
    await ref.read(chatControllerProvider.notifier).sendText(text);
  }

  Future<void> _attachPhoto() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 70);
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    final contentType = picked.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    await ref.read(chatControllerProvider.notifier).sendPhoto(bytes: bytes, contentType: contentType);
  }

  Future<void> _report(ChatMessage message) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showModalBottomSheet<bool>(
      context: context,
      builder: (_) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.flag_outlined, color: AppColors.accent),
              title: const Text('Report message'),
              subtitle: const Text('Flag this message for RoomAdda to review.'),
              onTap: () => Navigator.pop(context, true),
            ),
          ],
        ),
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(chatControllerProvider.notifier).report(message.id, reason: 'reported from chat');
      messenger.showSnackBar(const SnackBar(content: Text('Message reported. Thank you.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(apiExceptionFrom(e).message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(chatControllerProvider);
    final text = Theme.of(context).textTheme;

    if (state.loading && state.messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (!state.hasChat) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text("Chat isn't available right now.", textAlign: TextAlign.center, style: text.bodyMedium),
        ),
      );
    }

    final convo = state.conversation!;
    final reversed = state.messages.reversed.toList();

    return SafeArea(
      top: false,
      child: Column(
        children: [
          _Header(hostName: convo.hostName, repliesWithin: convo.repliesWithin),
          Expanded(
            child: state.messages.isEmpty
                ? Center(child: Text('Say hello to ${convo.hostName} 👋', style: text.bodyMedium?.copyWith(color: AppColors.mutedInk)))
                : ListView.builder(
                    reverse: true,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    itemCount: reversed.length,
                    itemBuilder: (_, i) => _Bubble(message: reversed[i], onReport: () => _report(reversed[i])),
                  ),
          ),
          if (state.error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(state.error!, style: const TextStyle(color: AppColors.accent, fontSize: 13)),
            ),
          if (convo.chatEnabled)
            _Composer(
              controller: _input,
              sending: state.sending,
              onSend: _send,
              onAttach: _attachPhoto,
              onChanged: (v) => ref.read(chatControllerProvider.notifier).notifyTyping(v.isNotEmpty),
            )
          else
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'This chat is closed because the booking has ended.',
                textAlign: TextAlign.center,
                style: text.bodySmall?.copyWith(color: AppColors.faintInk),
              ),
            ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.hostName, required this.repliesWithin});

  final String hostName;
  final String repliesWithin;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
      decoration: const BoxDecoration(
        color: AppColors.card,
        border: Border(bottom: BorderSide(color: AppColors.hairline)),
      ),
      child: Row(
        children: [
          const CircleAvatar(backgroundColor: AppColors.accentWash, child: Icon(Icons.person, color: AppColors.accent)),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(hostName, style: text.titleSmall),
              const SizedBox(height: 2),
              Text(repliesWithin, style: text.bodySmall?.copyWith(color: AppColors.mutedInk)),
            ],
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message, required this.onReport});

  final ChatMessage message;
  final VoidCallback onReport;

  @override
  Widget build(BuildContext context) {
    final mine = message.mine;
    final bg = mine ? AppColors.accent : AppColors.card;
    final fg = mine ? AppColors.onAccent : AppColors.ink;

    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onReport,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: AppRadii.cardBorder,
            border: mine ? null : Border.all(color: AppColors.hairline),
          ),
          clipBehavior: Clip.antiAlias,
          child: message.isPhoto ? _photo(message.photoUrl) : _textBody(fg),
        ),
      ),
    );
  }

  Widget _textBody(Color fg) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Text(message.text ?? '', style: TextStyle(color: fg)),
      );

  Widget _photo(String? url) {
    if (url == null) return const SizedBox(width: 160, height: 120, child: ColoredBox(color: AppColors.paperAlt));
    return Image.network(
      url,
      width: 200,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => const SizedBox(
        width: 160,
        height: 120,
        child: ColoredBox(
          color: AppColors.paperAlt,
          child: Icon(Icons.broken_image_outlined, color: AppColors.faintInk),
        ),
      ),
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.sending,
    required this.onSend,
    required this.onAttach,
    required this.onChanged,
  });

  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;
  final VoidCallback onAttach;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      decoration: const BoxDecoration(
        color: AppColors.card,
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          IconButton(
            icon: const Icon(Icons.add_photo_alternate_outlined, color: AppColors.mutedInk),
            onPressed: sending ? null : onAttach,
            tooltip: 'Send a photo',
          ),
          Expanded(
            child: TextField(
              controller: controller,
              minLines: 1,
              maxLines: 4,
              onChanged: onChanged,
              decoration: InputDecoration(
                hintText: 'Message…',
                filled: true,
                fillColor: AppColors.paperAlt,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(20), borderSide: BorderSide.none),
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              ),
            ),
          ),
          const SizedBox(width: 4),
          IconButton.filled(
            onPressed: sending ? null : onSend,
            icon: sending
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onAccent))
                : const Icon(Icons.send),
            style: IconButton.styleFrom(backgroundColor: AppColors.accent, foregroundColor: AppColors.onAccent),
          ),
        ],
      ),
    );
  }
}
