/// Mirrors the `TrustedContact` contract in `@roomadda/shared`. These contacts
/// (1–3) receive an SMS with the user's location on SOS.
class TrustedContact {
  final String id;
  final String name;
  final String phone;
  final DateTime createdAt;

  const TrustedContact({
    required this.id,
    required this.name,
    required this.phone,
    required this.createdAt,
  });

  factory TrustedContact.fromJson(Map<String, dynamic> json) => TrustedContact(
        id: json['id'] as String,
        name: json['name'] as String,
        phone: json['phone'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// GET /v1/trusted-contacts — the list plus the cap so the UI can disable "add".
class TrustedContactsView {
  final List<TrustedContact> items;
  final int max;

  const TrustedContactsView({required this.items, required this.max});

  bool get isFull => items.length >= max;
  bool get isEmpty => items.isEmpty;

  factory TrustedContactsView.fromJson(Map<String, dynamic> json) => TrustedContactsView(
        items: (json['items'] as List<dynamic>)
            .map((e) => TrustedContact.fromJson(e as Map<String, dynamic>))
            .toList(),
        max: json['max'] as int,
      );
}

/// POST /v1/sos result — how many contacts were SMSed and whether admin was alerted.
class SosResult {
  final int contactsNotified;
  final bool adminAlerted;

  const SosResult({required this.contactsNotified, required this.adminAlerted});

  factory SosResult.fromJson(Map<String, dynamic> json) => SosResult(
        contactsNotified: json['contactsNotified'] as int,
        adminAlerted: json['adminAlerted'] as bool,
      );
}
