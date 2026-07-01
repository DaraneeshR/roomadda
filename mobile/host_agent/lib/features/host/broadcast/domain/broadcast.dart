/// Mirrors the `BroadcastResponse` contract. A broadcast goes to all CURRENT
/// tenants of a property and is capped at [broadcastDailyLimit] per rolling 24h.
/// The compose box is hard-capped at [broadcastMaxChars] characters.
class BroadcastResult {
  final String id;
  final String body;
  final int recipientCount;
  final int remainingToday;
  final DateTime createdAt;

  const BroadcastResult({
    required this.id,
    required this.body,
    required this.recipientCount,
    required this.remainingToday,
    required this.createdAt,
  });

  factory BroadcastResult.fromJson(Map<String, dynamic> json) => BroadcastResult(
        id: json['id'] as String,
        body: json['body'] as String,
        recipientCount: json['recipientCount'] as int,
        remainingToday: json['remainingToday'] as int,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// Max characters in one broadcast (mirrors the backend `broadcastSchema`).
const broadcastMaxChars = 280;

/// Broadcasts allowed per property per rolling 24h (mirrors `BROADCAST_DAILY_LIMIT`).
const broadcastDailyLimit = 3;
