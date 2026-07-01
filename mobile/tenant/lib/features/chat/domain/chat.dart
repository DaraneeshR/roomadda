/// Mirrors the chat contracts in `@roomadda/shared`. The server is the source of
/// truth + audit; the app reads messages and never trusts client-side status.
/// A conversation exposes the host's NAME only — NO phone number is ever shared
/// in chat (enforced server-side).
class Conversation {
  final String id;
  final String bookingId;

  /// False once the booking is no longer CONFIRMED — sending is disabled.
  final bool chatEnabled;
  final String hostName;
  final String repliesWithin;

  const Conversation({
    required this.id,
    required this.bookingId,
    required this.chatEnabled,
    required this.hostName,
    required this.repliesWithin,
  });

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
        id: json['id'] as String,
        bookingId: json['bookingId'] as String,
        chatEnabled: json['chatEnabled'] as bool,
        hostName: (json['host'] as Map<String, dynamic>)['name'] as String,
        repliesWithin: json['repliesWithin'] as String,
      );
}

class ChatMessage {
  final String id;
  final String kind; // TEXT / PHOTO
  final String? text;
  final String? photoUrl;
  final String senderRole;

  /// True when the caller sent this message (drives bubble alignment).
  final bool mine;
  final DateTime createdAt;

  const ChatMessage({
    required this.id,
    required this.kind,
    required this.senderRole,
    required this.mine,
    required this.createdAt,
    this.text,
    this.photoUrl,
  });

  bool get isPhoto => kind == 'PHOTO';

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        id: json['id'] as String,
        kind: json['kind'] as String,
        text: json['text'] as String?,
        photoUrl: json['photoUrl'] as String?,
        senderRole: json['senderRole'] as String,
        mine: json['mine'] as bool,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class ChatPage {
  final List<ChatMessage> items;
  final String? nextCursor;

  const ChatPage({required this.items, this.nextCursor});
}

/// Merge message lists by id (server id wins) and return them oldest → newest.
/// Used to fold each poll/refetch into the on-screen thread without duplicates.
List<ChatMessage> mergeMessages(Iterable<ChatMessage> existing, Iterable<ChatMessage> incoming) {
  final byId = <String, ChatMessage>{};
  for (final m in existing) {
    byId[m.id] = m;
  }
  for (final m in incoming) {
    byId[m.id] = m;
  }
  final list = byId.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));
  return list;
}
