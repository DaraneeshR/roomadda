import 'package:roomadda_core/roomadda_core.dart';

/// Mirrors the `RentInvoice` contract in `@roomadda/shared`. `status` is the
/// EFFECTIVE status the server computes (PAID / OVERDUE / DUE) — the app only
/// renders it and NEVER decides PAID itself (RENT IS MONEY: payment truth is the
/// verified webhook, see /CLAUDE.md). `paidAt` is null until that webhook lands.
class RentInvoice {
  final String id;
  final String bookingId;
  final DateTime periodMonth;
  final String periodLabel;
  final Paise amount;
  final DateTime dueDate;
  final String status; // DUE / PAID / OVERDUE
  final int daysOverdue;
  final DateTime? paidAt;
  final DateTime createdAt;

  const RentInvoice({
    required this.id,
    required this.bookingId,
    required this.periodMonth,
    required this.periodLabel,
    required this.amount,
    required this.dueDate,
    required this.status,
    required this.daysOverdue,
    required this.createdAt,
    this.paidAt,
  });

  bool get isPaid => status == 'PAID';
  bool get isOverdue => status == 'OVERDUE';
  bool get isDue => status == 'DUE';
  bool get isUnpaid => !isPaid;

  factory RentInvoice.fromJson(Map<String, dynamic> json) => RentInvoice(
        id: json['id'] as String,
        bookingId: json['bookingId'] as String,
        periodMonth: DateTime.parse(json['periodMonth'] as String),
        periodLabel: json['periodLabel'] as String,
        amount: Paise(json['amountPaise'] as int),
        dueDate: DateTime.parse(json['dueDate'] as String),
        status: json['status'] as String,
        daysOverdue: json['daysOverdue'] as int,
        paidAt: json['paidAt'] == null ? null : DateTime.parse(json['paidAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// A page of the tenant's own rent invoices (cursor-paginated, newest due first).
class RentPage {
  final List<RentInvoice> items;
  final String? nextCursor;

  const RentPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;
}

/// The invoice the dashboard rent card should surface: the most recent UNPAID
/// invoice (the one the tenant must act on), else the newest invoice, else null.
/// The list is newest-due-first, so the first match is the right one.
RentInvoice? currentRentInvoice(List<RentInvoice> invoices) {
  if (invoices.isEmpty) return null;
  for (final inv in invoices) {
    if (inv.isUnpaid) return inv;
  }
  return invoices.first;
}
