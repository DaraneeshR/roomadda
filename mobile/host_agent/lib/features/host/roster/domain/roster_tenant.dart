import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `RosterTenant` contract. A CURRENT or PAST tenant of one of the
/// host's listings. The roster carries NO KYC and NO other tenant's data — only
/// name, room, move-in and rent status (/CLAUDE.md domain rule #4 + the host
/// privacy requirement). This model deliberately exposes NO phone, NO Aadhaar and
/// NO documents; the host never sees a tenant's KYC anywhere in the app.
class RosterTenant {
  final String kind; // BOOKING / WALK_IN
  final String id;
  final String name;
  final String roomName;
  final DateTime? moveInDate;
  final Paise monthlyRent;
  final String rentStatus; // PAID / DUE / OVERDUE / NOT_TRACKED
  final DateTime? moveOutDate;
  final int? durationDays;

  const RosterTenant({
    required this.kind,
    required this.id,
    required this.name,
    required this.roomName,
    required this.moveInDate,
    required this.monthlyRent,
    required this.rentStatus,
    required this.moveOutDate,
    required this.durationDays,
  });

  bool get isWalkIn => kind == 'WALK_IN';

  factory RosterTenant.fromJson(Map<String, dynamic> json) => RosterTenant(
        kind: json['kind'] as String,
        id: json['id'] as String,
        name: json['name'] as String,
        roomName: json['roomName'] as String,
        moveInDate: _date(json['moveInDate']),
        monthlyRent: Paise(json['monthlyRentPaise'] as int),
        rentStatus: json['rentStatus'] as String,
        moveOutDate: _date(json['moveOutDate']),
        durationDays: json['durationDays'] as int?,
      );
}

DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String);

String rentStatusLabel(String status) => switch (status) {
      'PAID' => 'Rent paid',
      'DUE' => 'Rent due',
      'OVERDUE' => 'Overdue',
      'NOT_TRACKED' => 'Off-platform',
      _ => status,
    };
