import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../data/chat_repository.dart';
import '../domain/chat.dart';

/// On-screen chat state. `messages` is oldest → newest for display.
class ChatState {
  final Conversation? conversation;
  final List<ChatMessage> messages;
  final bool loading;
  final bool sending;
  final String? error;

  const ChatState({
    this.conversation,
    this.messages = const [],
    this.loading = true,
    this.sending = false,
    this.error,
  });

  bool get hasChat => conversation != null;
  bool get chatEnabled => conversation?.chatEnabled ?? false;

  ChatState copyWith({
    Conversation? conversation,
    List<ChatMessage>? messages,
    bool? loading,
    bool? sending,
    Object? error = _unset,
  }) {
    return ChatState(
      conversation: conversation ?? this.conversation,
      messages: messages ?? this.messages,
      loading: loading ?? this.loading,
      sending: sending ?? this.sending,
      error: error == _unset ? this.error : error as String?,
    );
  }

  static const Object _unset = Object();
}

/// Drives the chat screen: loads the current conversation + history, folds each
/// poll/refetch into the thread (the screen polls on a timer for near-real-time;
/// a Firestore listener replaces polling in production), and sends text/photos.
/// Status is server-owned — sending is blocked once `chatEnabled` is false.
class ChatController extends StateNotifier<ChatState> {
  ChatController(this._repo) : super(const ChatState());

  final ChatRepository _repo;

  Future<void> load() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final conversation = await _repo.fetchCurrent();
      if (conversation == null) {
        state = state.copyWith(loading: false, conversation: null);
        return;
      }
      final page = await _repo.listMessages(conversation.id);
      state = ChatState(
        conversation: conversation,
        messages: mergeMessages(const [], page.items),
        loading: false,
      );
    } catch (e) {
      state = state.copyWith(loading: false, error: apiExceptionFrom(e).message);
    }
  }

  /// Poll for new messages and fold them in (deduped). Silent on failure.
  Future<void> refresh() async {
    final convo = state.conversation;
    if (convo == null) return;
    try {
      final page = await _repo.listMessages(convo.id);
      state = state.copyWith(messages: mergeMessages(state.messages, page.items));
    } catch (_) {/* keep the current thread; try again next tick */}
  }

  Future<void> sendText(String text) async {
    final convo = state.conversation;
    final body = text.trim();
    if (convo == null || body.isEmpty || state.sending) return;
    state = state.copyWith(sending: true, error: null);
    try {
      final message = await _repo.sendText(convo.id, body);
      state = state.copyWith(sending: false, messages: mergeMessages(state.messages, [message]));
    } catch (e) {
      state = state.copyWith(sending: false, error: apiExceptionFrom(e).message);
    }
  }

  /// Upload then send a photo. The caller supplies the bytes + content type.
  Future<void> sendPhoto({required Uint8List bytes, required String contentType}) async {
    final convo = state.conversation;
    if (convo == null || state.sending) return;
    state = state.copyWith(sending: true, error: null);
    try {
      final target = await _repo.requestPhotoUrl(contentType);
      await _repo.uploadBytes(target.uploadUrl, bytes, contentType);
      final message = await _repo.sendPhoto(convo.id, target.key);
      state = state.copyWith(sending: false, messages: mergeMessages(state.messages, [message]));
    } catch (e) {
      state = state.copyWith(sending: false, error: apiExceptionFrom(e).message);
    }
  }

  void notifyTyping(bool isTyping) {
    final convo = state.conversation;
    if (convo != null) _repo.sendTyping(convo.id, isTyping);
  }

  Future<void> report(String messageId, {String? reason}) =>
      _repo.reportMessage(messageId, reason: reason);
}

final chatControllerProvider = StateNotifierProvider.autoDispose<ChatController, ChatState>(
  (ref) => ChatController(ref.read(chatRepositoryProvider)),
);
