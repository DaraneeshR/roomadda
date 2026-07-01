/// Mirrors the `LeaveNotice` contract in `@roomadda/shared`. Status and
/// `canWithdraw` are SERVER-OWNED (the 3-day lock is enforced server-side); the
/// app only reads them.
class LeaveNotice {
  final String id;
  final DateTime moveOutDate;
  final String status; // ACTIVE / WITHDRAWN
  final bool canWithdraw;
  final DateTime? withdrawnAt;
  final DateTime createdAt;

  const LeaveNotice({
    required this.id,
    required this.moveOutDate,
    required this.status,
    required this.canWithdraw,
    required this.createdAt,
    this.withdrawnAt,
  });

  bool get isActive => status == 'ACTIVE';

  factory LeaveNotice.fromJson(Map<String, dynamic> json) => LeaveNotice(
        id: json['id'] as String,
        moveOutDate: DateTime.parse(json['moveOutDate'] as String),
        status: json['status'] as String,
        canWithdraw: json['canWithdraw'] as bool,
        withdrawnAt: json['withdrawnAt'] == null ? null : DateTime.parse(json['withdrawnAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// GET /v1/leave-notices — own notices plus the policy the form needs (so the
/// date picker's minimum comes from the server, not a duplicated constant).
class LeaveNoticeView {
  final List<LeaveNotice> items;
  final int noticePeriodDays;
  final DateTime earliestMoveOutDate;

  const LeaveNoticeView({
    required this.items,
    required this.noticePeriodDays,
    required this.earliestMoveOutDate,
  });

  /// The current active notice, if any (a tenant has at most one).
  LeaveNotice? get active {
    for (final n in items) {
      if (n.isActive) return n;
    }
    return null;
  }

  factory LeaveNoticeView.fromJson(Map<String, dynamic> json) => LeaveNoticeView(
        items: (json['items'] as List<dynamic>)
            .map((e) => LeaveNotice.fromJson(e as Map<String, dynamic>))
            .toList(),
        noticePeriodDays: json['noticePeriodDays'] as int,
        earliestMoveOutDate: DateTime.parse(json['earliestMoveOutDate'] as String),
      );
}
