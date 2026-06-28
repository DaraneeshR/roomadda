/// Move-in date rules for the booking sheet. Pure so the validation is unit-
/// tested without a widget. The sheet blocks past dates (and disables full rooms
/// — the closest "booked dates blocked" we can express without per-date data).
DateTime dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

/// A day is a valid move-in date only if it is today or later.
bool isSelectableMoveInDate(DateTime day, {required DateTime now}) =>
    !dateOnly(day).isBefore(dateOnly(now));

/// The earliest date the picker should allow (today).
DateTime firstSelectableMoveInDate(DateTime now) => dateOnly(now);
