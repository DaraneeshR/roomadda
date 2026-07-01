import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_tenant/features/chat/domain/chat.dart';

ChatMessage _msg(String id, String at, {bool mine = true, String text = 'hi'}) => ChatMessage.fromJson({
      'id': id,
      'kind': 'TEXT',
      'text': text,
      'photoUrl': null,
      'senderRole': mine ? 'TENANT' : 'HOST',
      'mine': mine,
      'createdAt': at,
    });

void main() {
  group('Conversation.fromJson', () {
    test('reads the host NAME only (no phone number is exposed in chat)', () {
      final convo = Conversation.fromJson({
        'id': 'c1',
        'bookingId': 'b1',
        'chatEnabled': true,
        'host': {'name': 'Host Hema'},
        'repliesWithin': 'Usually replies within a few hours',
      });
      expect(convo.hostName, 'Host Hema');
      expect(convo.chatEnabled, isTrue);
      expect(convo.repliesWithin, contains('replies'));
    });
  });

  group('ChatMessage.fromJson', () {
    test('parses text and photo messages', () {
      final t = _msg('m1', '2026-06-28T10:00:00.000Z');
      expect(t.isPhoto, isFalse);
      expect(t.text, 'hi');
      expect(t.mine, isTrue);

      final p = ChatMessage.fromJson({
        'id': 'm2',
        'kind': 'PHOTO',
        'text': null,
        'photoUrl': 'https://example/p.jpg',
        'senderRole': 'HOST',
        'mine': false,
        'createdAt': '2026-06-28T10:01:00.000Z',
      });
      expect(p.isPhoto, isTrue);
      expect(p.photoUrl, 'https://example/p.jpg');
      expect(p.mine, isFalse);
    });
  });

  group('mergeMessages', () {
    test('dedupes by id and orders oldest -> newest', () {
      final existing = [_msg('a', '2026-06-28T10:00:00.000Z'), _msg('b', '2026-06-28T10:02:00.000Z')];
      final incoming = [
        _msg('b', '2026-06-28T10:02:00.000Z', text: 'updated'), // same id wins
        _msg('c', '2026-06-28T10:01:00.000Z'),
      ];

      final merged = mergeMessages(existing, incoming);
      expect(merged.map((m) => m.id).toList(), ['a', 'c', 'b']); // sorted by time
      expect(merged.firstWhere((m) => m.id == 'b').text, 'updated');
    });

    test('is a no-op shape when nothing new arrives', () {
      final existing = [_msg('a', '2026-06-28T10:00:00.000Z')];
      expect(mergeMessages(existing, const []).map((m) => m.id), ['a']);
    });
  });
}
