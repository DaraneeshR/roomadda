/// Mirrors the `HostServiceRequest` contract — a maintenance ticket as the HOST
/// sees it. The host can acknowledge / note / resolve but NEVER delete (no delete
/// path exists). The host sees the tenant's display name and room only — NO KYC.
/// Lifecycle is server-owned: SUBMITTED -> ACKNOWLEDGED -> RESOLVED.
class HostServiceRequest {
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
  final DateTime? escalatedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String tenantName;
  final String? roomName;
  final List<ServiceComment> comments;

  const HostServiceRequest({
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
    required this.tenantName,
    this.roomName,
    this.rating,
    this.acknowledgedAt,
    this.resolvedAt,
    this.escalatedAt,
    this.comments = const [],
  });

  bool get isUrgent => priority == 'URGENT';
  bool get isSubmitted => status == 'SUBMITTED';
  bool get isResolved => status == 'RESOLVED';
  bool get canAcknowledge => status == 'SUBMITTED';
  bool get canResolve => status != 'RESOLVED';

  factory HostServiceRequest.fromJson(Map<String, dynamic> json) => HostServiceRequest(
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
        escalatedAt: _date(json['escalatedAt']),
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        tenantName: json['tenantName'] as String,
        roomName: json['roomName'] as String?,
        comments: (json['comments'] as List<dynamic>? ?? const [])
            .map((e) => ServiceComment.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class ServiceComment {
  final String id;
  final String authorRole;
  final String authorName;
  final String body;
  final DateTime createdAt;

  const ServiceComment({
    required this.id,
    required this.authorRole,
    required this.authorName,
    required this.body,
    required this.createdAt,
  });

  factory ServiceComment.fromJson(Map<String, dynamic> json) => ServiceComment(
        id: json['id'] as String,
        authorRole: json['authorRole'] as String,
        authorName: json['authorName'] as String,
        body: json['body'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// Queue rollups for the dashboard / queue header.
class HostServiceStats {
  final int openCount;
  final int escalatedCount;
  final double? avgResolutionHours;

  const HostServiceStats({
    required this.openCount,
    required this.escalatedCount,
    this.avgResolutionHours,
  });

  factory HostServiceStats.fromJson(Map<String, dynamic> json) => HostServiceStats(
        openCount: json['openCount'] as int,
        escalatedCount: json['escalatedCount'] as int,
        avgResolutionHours: (json['avgResolutionHours'] as num?)?.toDouble(),
      );
}

class HostServiceQueue {
  final List<HostServiceRequest> items;
  final String? nextCursor;
  final HostServiceStats stats;

  const HostServiceQueue({required this.items, required this.stats, this.nextCursor});

  bool get hasMore => nextCursor != null;

  factory HostServiceQueue.fromJson(Map<String, dynamic> json) => HostServiceQueue(
        items: (json['items'] as List<dynamic>)
            .map((e) => HostServiceRequest.fromJson(e as Map<String, dynamic>))
            .toList(),
        nextCursor: json['nextCursor'] as String?,
        stats: HostServiceStats.fromJson(json['stats'] as Map<String, dynamic>),
      );
}

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

String serviceStatusLabel(String status) => switch (status) {
      'SUBMITTED' => 'Submitted',
      'ACKNOWLEDGED' => 'Acknowledged',
      'RESOLVED' => 'Resolved',
      _ => status,
    };

DateTime? _date(dynamic v) => v == null ? null : DateTime.parse(v as String);
