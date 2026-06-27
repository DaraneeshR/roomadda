import 'package:intl/intl.dart';

/// Money as integer paise. Amounts are NEVER stored or computed as `double`
/// (see /CLAUDE.md: money is always integer paise). The only division by 100 is
/// for display formatting.
class Paise {
  final int value;
  const Paise(this.value);

  factory Paise.fromRupees(num rupees) => Paise((rupees * 100).round());
  factory Paise.fromJson(int paise) => Paise(paise);

  int toJson() => value;

  Paise operator +(Paise other) => Paise(value + other.value);
  Paise operator -(Paise other) => Paise(value - other.value);
  bool operator >=(Paise other) => value >= other.value;

  static final NumberFormat _inr =
      NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2);

  /// Indian-locale currency string, e.g. "₹12,000.00". Display only.
  String format() => _inr.format(value / 100);

  @override
  String toString() => format();

  @override
  bool operator ==(Object other) => other is Paise && other.value == value;

  @override
  int get hashCode => value.hashCode;
}
