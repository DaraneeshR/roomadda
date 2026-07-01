/// Mirrors the `ServiceRequest` / `ServiceRequestDetail` contracts in
/// `@roomadda/shared`. Status is SERVER-OWNED (Submitted → Acknowledged →
/// Resolved): the app only reads it. Photos are stored server-side; the app sees
/// just a [photoCount]. `comments` is empty on list rows and populated on detail.
class ServiceRequest {
  final String id;
  final String ticketNumber;
  final String category;
  final String description;
  final String priority; // NORMAL / URGENT
  final String status; // SUBMITTED / ACKNOWLEDGED / RESOLVED
  final int photoCount;
  final bool escalated;
  final int? rating;
  final DateTime? acknowledgedAt;
  final DateTime? resolvedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final List<ServiceRequestComment> comments;

  const ServiceRequest({
    required this.id,
    required this.ticketNumber,
    required this.category,
    required this.description,
    required this.priority,
    required this.status,
    required this.photoCount,
    required this.escalated,
    required this.createdAt,
    required this.updatedAt,
    this.rating,
    this.acknowledgedAt,
    this.resolvedAt,
    this.comments = const [],
  });

  bool get isUrgent => priority == 'URGENT';
  bool get isResolved => status == 'RESOLVED';

  /// The resolve flow prompts for a 1–5 rating once, only after resolution.
  bool get needsRating => isResolved && rating == null;

  factory ServiceRequest.fromJson(Map<String, dynamic> json) => ServiceRequest(
        id: json['id'] as String,
        ticketNumber: json['ticketNumber'] as String,
        category: json['category'] as String,
        description: json['description'] as String,
        priority: json['priority'] as String,
        status: json['status'] as String,
        photoCount: json['photoCount'] as int,
        escalated: json['escalated'] as bool,
        rating: json['rating'] as int?,
        acknowledgedAt: _date(json['acknowledgedAt']),
        resolvedAt: _date(json['resolvedAt']),
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        comments: (json['comments'] as List<dynamic>? ?? const [])
            .map((e) => ServiceRequestComment.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ServiceRequestComment {
  final String id;
  final String authorRole;
  final String authorName;
  final String body;
  final DateTime createdAt;

  const ServiceRequestComment({
    required this.id,
    required this.authorRole,
    required this.authorName,
    required this.body,
    required this.createdAt,
  });

  factory ServiceRequestComment.fromJson(Map<String, dynamic> json) => ServiceRequestComment(
        id: json['id'] as String,
        authorRole: json['authorRole'] as String,
        authorName: json['authorName'] as String,
        body: json['body'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class ServiceRequestPage {
  final List<ServiceRequest> items;
  final String? nextCursor;

  const ServiceRequestPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;
}

DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String);

/// Selectable categories (mirrors the backend enum, same order).
const serviceCategories = <String>[
  'PLUMBING',
  'ELECTRICAL',
  'CLEANING',
  'APPLIANCE',
  'WIFI',
  'FURNITURE',
  'PEST_CONTROL',
  'OTHER',
];

String serviceCategoryLabel(String category) => switch (category) {
      'PLUMBING' => 'Plumbing',
      'ELECTRICAL' => 'Electrical',
      'CLEANING' => 'Cleaning',
      'APPLIANCE' => 'Appliance',
      'WIFI' => 'Wi-Fi',
      'FURNITURE' => 'Furniture',
      'PEST_CONTROL' => 'Pest control',
      'OTHER' => 'Other',
      _ => category,
    };

/// The status's position in the Submitted → Acknowledged → Resolved tracker.
int serviceStatusStep(String status) => switch (status) {
      'SUBMITTED' => 0,
      'ACKNOWLEDGED' => 1,
      'RESOLVED' => 2,
      _ => 0,
    };

String serviceStatusLabel(String status) => switch (status) {
      'SUBMITTED' => 'Submitted',
      'ACKNOWLEDGED' => 'Acknowledged',
      'RESOLVED' => 'Resolved',
      _ => status,
    };
