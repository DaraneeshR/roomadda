/// Mirrors the `MealMenuDay` / `MealSlot` contracts in `@roomadda/shared`. The
/// server is the source of truth for the menu; the app only renders it. A slot
/// with no dish (or one the host marked not-served) shows "Not available today";
/// a whole day with [notUpdated] shows the "Menu not updated yet" empty state.
class MealSlot {
  /// Dish text; null when the host has not filled this slot.
  final String? text;

  /// True when the host explicitly marked this slot not served that day.
  final bool notAvailable;

  const MealSlot({this.text, required this.notAvailable});

  /// Whether there's a dish to show. Empty or explicitly-closed slots render as
  /// "Not available today".
  bool get hasDish => text != null && text!.trim().isNotEmpty;

  factory MealSlot.fromJson(Map<String, dynamic> json) => MealSlot(
        text: json['text'] as String?,
        notAvailable: json['notAvailable'] as bool,
      );
}

class MealMenuDay {
  final DateTime date;
  final MealSlot breakfast;
  final MealSlot lunch;
  final MealSlot dinner;

  /// Host who last edited the menu; null when the day has no menu.
  final String? updatedByHostName;

  /// When the menu was last edited; null when the day has no menu.
  final DateTime? updatedAt;

  /// True when there is no menu for this day at all ("not updated yet").
  final bool notUpdated;

  const MealMenuDay({
    required this.date,
    required this.breakfast,
    required this.lunch,
    required this.dinner,
    required this.notUpdated,
    this.updatedByHostName,
    this.updatedAt,
  });

  factory MealMenuDay.fromJson(Map<String, dynamic> json) => MealMenuDay(
        date: DateTime.parse(json['date'] as String),
        breakfast: MealSlot.fromJson(json['breakfast'] as Map<String, dynamic>),
        lunch: MealSlot.fromJson(json['lunch'] as Map<String, dynamic>),
        dinner: MealSlot.fromJson(json['dinner'] as Map<String, dynamic>),
        updatedByHostName: json['updatedByHostName'] as String?,
        updatedAt: json['updatedAt'] == null ? null : DateTime.parse(json['updatedAt'] as String),
        notUpdated: json['notUpdated'] as bool,
      );
}
