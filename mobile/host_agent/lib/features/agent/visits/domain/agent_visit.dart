/// Mirrors the `AgentVisit` contract in `@roomadda/shared`. The agent is a
/// privileged role, so the server returns the UNMASKED property identity/address
/// (the agent must navigate to and inspect the property) — this is not a masking
/// leak (see /CLAUDE.md rule #4: masking is enforced server-side per role).
class AgentVisit {
  final String id;
  final String listingId;
  final String alias;
  final String actualName;
  final String areaLabel;
  final String city;
  final String fullAddress;
  final double latitude;
  final double longitude;
  final String status; // SCHEDULED / COMPLETED / CANCELLED
  final DateTime scheduledAt;
  final DateTime? visitedAt;
  final String? notes;

  /// The recorded GPS check-in, or null until the agent checks in. `withinRange`
  /// is false for an out-of-range "cannot reach property" check-in.
  final AgentCheckIn? checkIn;

  /// The inspection's status (DRAFT/SUBMITTED/...), or null if not started.
  final String? inspectionStatus;

  const AgentVisit({
    required this.id,
    required this.listingId,
    required this.alias,
    required this.actualName,
    required this.areaLabel,
    required this.city,
    required this.fullAddress,
    required this.latitude,
    required this.longitude,
    required this.status,
    required this.scheduledAt,
    this.visitedAt,
    this.notes,
    this.checkIn,
    this.inspectionStatus,
  });

  bool get isScheduled => status == 'SCHEDULED';
  bool get isCompleted => status == 'COMPLETED';
  bool get isCancelled => status == 'CANCELLED';

  /// A VALID check-in exists (within 200m). The inspection is LOCKED until this is
  /// true — the server enforces the same gate on submit; the UI mirrors it.
  bool get hasValidCheckIn => checkIn?.withinRange == true;

  /// The agent checked in but was out of range — the "cannot reach property" flag
  /// path (recorded, surfaced, but not a valid check-in).
  bool get checkedInOutOfRange => checkIn != null && checkIn!.withinRange == false;

  bool get inspectionSubmitted =>
      inspectionStatus != null && inspectionStatus != 'DRAFT';

  factory AgentVisit.fromJson(Map<String, dynamic> json) => AgentVisit(
        id: json['id'] as String,
        listingId: json['listingId'] as String,
        alias: json['alias'] as String,
        actualName: json['actualName'] as String,
        areaLabel: json['areaLabel'] as String,
        city: json['city'] as String,
        fullAddress: json['fullAddress'] as String,
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        status: json['status'] as String,
        scheduledAt: DateTime.parse(json['scheduledAt'] as String),
        visitedAt: json['visitedAt'] == null ? null : DateTime.parse(json['visitedAt'] as String),
        notes: json['notes'] as String?,
        checkIn: json['checkIn'] == null
            ? null
            : AgentCheckIn.fromJson(json['checkIn'] as Map<String, dynamic>),
        inspectionStatus: json['inspectionStatus'] as String?,
      );
}

/// A GPS check-in recorded on a visit (mirrors `AgentCheckInDto`). `withinRange`
/// is SERVER-OWNED: it is the PostGIS ST_DWithin verdict, never decided on-device.
class AgentCheckIn {
  final double lat;
  final double lng;
  final DateTime at;
  final double distanceM;
  final bool withinRange;

  const AgentCheckIn({
    required this.lat,
    required this.lng,
    required this.at,
    required this.distanceM,
    required this.withinRange,
  });

  factory AgentCheckIn.fromJson(Map<String, dynamic> json) => AgentCheckIn(
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        at: DateTime.parse(json['at'] as String),
        distanceM: (json['distanceM'] as num).toDouble(),
        withinRange: json['withinRange'] as bool,
      );
}

/// The response of POST /agent/visits/:id/check-in. `withinRange` is the server's
/// ST_DWithin verdict; an out-of-range point is recorded (`cannotReachProperty`)
/// but does NOT unlock the inspection.
class CheckInResult {
  final String visitId;
  final bool withinRange;
  final bool cannotReachProperty;
  final double? distanceM;
  final double radiusM;
  final DateTime checkedInAt;

  const CheckInResult({
    required this.visitId,
    required this.withinRange,
    required this.cannotReachProperty,
    required this.distanceM,
    required this.radiusM,
    required this.checkedInAt,
  });

  factory CheckInResult.fromJson(Map<String, dynamic> json) => CheckInResult(
        visitId: json['visitId'] as String,
        withinRange: json['withinRange'] as bool,
        cannotReachProperty: json['cannotReachProperty'] as bool,
        distanceM: json['distanceM'] == null ? null : (json['distanceM'] as num).toDouble(),
        radiusM: (json['radiusM'] as num).toDouble(),
        checkedInAt: DateTime.parse(json['checkedInAt'] as String),
      );
}

/// A page of visits (cursor-paginated by the server).
class AgentVisitPage {
  final List<AgentVisit> items;
  final String? nextCursor;

  const AgentVisitPage({required this.items, this.nextCursor});

  bool get hasMore => nextCursor != null;
}
