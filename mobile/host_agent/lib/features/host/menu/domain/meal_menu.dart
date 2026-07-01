/// Mirrors the `MealMenuDay` / `MealSlot` / `MealTemplate` contracts. The host can
/// edit TODAY or TOMORROW directly (writeDay); plan further ahead with weekly
/// templates. A slot's [text] is the dish; [notAvailable] is the host's "not
/// served today" flag. A day with no row at all has [notUpdated] true.
class MealSlot {
  final String? text;
  final bool notAvailable;

  const MealSlot({this.text, this.notAvailable = false});

  bool get isEmpty => (text == null || text!.isEmpty) && !notAvailable;

  factory MealSlot.fromJson(Map<String, dynamic> json) => MealSlot(
        text: json['text'] as String?,
        notAvailable: json['notAvailable'] as bool? ?? false,
      );

  /// Wire shape for an upsert slot (omit a slot entirely to leave it empty).
  Map<String, dynamic> toJson() => {
        if (text != null) 'text': text,
        'notAvailable': notAvailable,
      };
}

class MealMenuDay {
  final DateTime date;
  final MealSlot breakfast;
  final MealSlot lunch;
  final MealSlot dinner;
  final String? updatedByHostName;
  final DateTime? updatedAt;
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

/// A saved weekly template (Mon→Sun, three slots each).
class MealTemplate {
  final String id;
  final String name;
  final Map<String, WeeklyMenuDay> days;
  final DateTime createdAt;
  final DateTime updatedAt;

  const MealTemplate({
    required this.id,
    required this.name,
    required this.days,
    required this.createdAt,
    required this.updatedAt,
  });

  factory MealTemplate.fromJson(Map<String, dynamic> json) {
    final raw = json['days'] as Map<String, dynamic>;
    return MealTemplate(
      id: json['id'] as String,
      name: json['name'] as String,
      days: {
        for (final wd in weekdays) wd: WeeklyMenuDay.fromJson(raw[wd] as Map<String, dynamic>),
      },
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

class WeeklyMenuDay {
  final MealSlot breakfast;
  final MealSlot lunch;
  final MealSlot dinner;

  const WeeklyMenuDay({required this.breakfast, required this.lunch, required this.dinner});

  factory WeeklyMenuDay.fromJson(Map<String, dynamic> json) => WeeklyMenuDay(
        breakfast: MealSlot.fromJson(json['breakfast'] as Map<String, dynamic>),
        lunch: MealSlot.fromJson(json['lunch'] as Map<String, dynamic>),
        dinner: MealSlot.fromJson(json['dinner'] as Map<String, dynamic>),
      );

  Map<String, dynamic> toJson() => {
        'breakfast': breakfast.toJson(),
        'lunch': lunch.toJson(),
        'dinner': dinner.toJson(),
      };
}

const weekdays = <String>['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const mealSlotNames = <String>['breakfast', 'lunch', 'dinner'];

String weekdayLabel(String wd) => switch (wd) {
      'mon' => 'Mon',
      'tue' => 'Tue',
      'wed' => 'Wed',
      'thu' => 'Thu',
      'fri' => 'Fri',
      'sat' => 'Sat',
      'sun' => 'Sun',
      _ => wd,
    };

String mealSlotLabel(String slot) => switch (slot) {
      'breakfast' => 'Breakfast',
      'lunch' => 'Lunch',
      'dinner' => 'Dinner',
      _ => slot,
    };
