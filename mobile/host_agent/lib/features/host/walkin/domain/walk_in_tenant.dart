import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `WalkInTenant` contract. A host-recorded off-platform occupant.
/// The full Aadhaar number NEVER leaves the server — only [aadhaarLast4] is
/// returned. Recording a walk-in BLOCKS a bed (reduces availability) and fires
/// the app-invite SMS; the payment mode is recorded, never processed in-app.
class WalkInTenant {
  final String id;
  final String name;
  final String phone;
  final String aadhaarLast4;
  final String roomId;
  final String roomName;
  final DateTime moveInDate;
  final Paise monthlyRent;
  final Paise deposit;
  final String paymentMode; // CASH / UPI / BANK_TRANSFER / OTHER
  final bool invited;
  final DateTime? invitedAt;
  final DateTime? checkedOutAt;
  final DateTime createdAt;

  const WalkInTenant({
    required this.id,
    required this.name,
    required this.phone,
    required this.aadhaarLast4,
    required this.roomId,
    required this.roomName,
    required this.moveInDate,
    required this.monthlyRent,
    required this.deposit,
    required this.paymentMode,
    required this.invited,
    required this.createdAt,
    this.invitedAt,
    this.checkedOutAt,
  });

  bool get isResident => checkedOutAt == null;

  factory WalkInTenant.fromJson(Map<String, dynamic> json) => WalkInTenant(
        id: json['id'] as String,
        name: json['name'] as String,
        phone: json['phone'] as String,
        aadhaarLast4: json['aadhaarLast4'] as String,
        roomId: json['roomId'] as String,
        roomName: json['roomName'] as String,
        moveInDate: DateTime.parse(json['moveInDate'] as String),
        monthlyRent: Paise(json['monthlyRentPaise'] as int),
        deposit: Paise(json['depositPaise'] as int),
        paymentMode: json['paymentMode'] as String,
        invited: json['invited'] as bool,
        invitedAt: _date(json['invitedAt']),
        checkedOutAt: _date(json['checkedOutAt']),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class WalkInPage {
  final List<WalkInTenant> items;
  final String? nextCursor;

  const WalkInPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;
}

DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String);

/// Selectable payment modes (mirrors the backend enum, same order).
const walkInPaymentModes = <String>['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER'];

String paymentModeLabel(String mode) => switch (mode) {
      'CASH' => 'Cash',
      'UPI' => 'UPI',
      'BANK_TRANSFER' => 'Bank transfer',
      'OTHER' => 'Other',
      _ => mode,
    };
