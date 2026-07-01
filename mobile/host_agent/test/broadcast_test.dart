import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_core/roomadda_core.dart';
import 'package:roomadda_host_agent/features/host/broadcast/application/broadcast_controller.dart';
import 'package:roomadda_host_agent/features/host/broadcast/data/broadcast_repository.dart';
import 'package:roomadda_host_agent/features/host/broadcast/domain/broadcast.dart';

/// Fake broadcast repo: returns a decreasing daily quota, or throws the cap
/// rejection when [throwCap] is set.
class _FakeBroadcastRepo implements BroadcastRepository {
  int remaining;
  bool throwCap;
  int sends = 0;

  _FakeBroadcastRepo({this.remaining = 2, this.throwCap = false});

  @override
  Future<BroadcastResult> send(String listingId, String body) async {
    sends++;
    if (throwCap) {
      throw const ApiException(
        statusCode: 429,
        code: 'BROADCAST_LIMIT_REACHED',
        message: 'A property can send at most 3 broadcasts per day',
      );
    }
    remaining = remaining - 1;
    return BroadcastResult(
      id: 'bc-$sends',
      body: body,
      recipientCount: 4,
      remainingToday: remaining,
      createdAt: DateTime.utc(2026, 6, 30),
    );
  }
}

void main() {
  group('broadcast cap', () {
    test('a successful send records the recipient count + remaining quota', () async {
      final repo = _FakeBroadcastRepo(remaining: 3);
      final c = BroadcastController(repo, 'l1');

      expect(c.state.remaining, broadcastDailyLimit, reason: 'assume full quota until told otherwise');

      final ok = await c.send('Water off tomorrow 10–12');
      expect(ok, isTrue);
      expect(c.state.lastResult?.recipientCount, 4);
      expect(c.state.remainingToday, 2);
      expect(c.state.canSend, isTrue);
    });

    test('reaching zero remaining disables further sends (no repo call)', () async {
      final repo = _FakeBroadcastRepo(remaining: 1);
      final c = BroadcastController(repo, 'l1');

      await c.send('one'); // remaining 1 -> 0
      expect(c.state.remainingToday, 0);
      expect(c.state.capReached, isTrue);
      expect(c.state.canSend, isFalse);

      final blocked = await c.send('two');
      expect(blocked, isFalse, reason: 'cap reached -> short-circuits');
      expect(repo.sends, 1, reason: 'the second send never hit the repo');
    });

    test('a 429 cap rejection pins the quota to zero', () async {
      final repo = _FakeBroadcastRepo(throwCap: true);
      final c = BroadcastController(repo, 'l1');

      final ok = await c.send('hello');
      expect(ok, isFalse);
      expect(c.state.capReached, isTrue);
      expect(c.state.remainingToday, 0);
      expect(c.state.error, isNotNull);
    });
  });
}
