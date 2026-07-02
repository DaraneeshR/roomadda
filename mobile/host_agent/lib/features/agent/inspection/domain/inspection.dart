/// The minimum geotagged + timestamped photos an inspection needs before it can
/// be submitted. Mirrors the backend `MIN_INSPECTION_PHOTOS`; the server enforces
/// it too — this is the client-side gate so the button is disabled until met.
const int kMinInspectionPhotos = 8;

/// Per-amenity verdict (mirrors the shared `AmenityCheck`).
enum AmenityCheck {
  yes,
  no,
  partial;

  String get api => switch (this) {
        AmenityCheck.yes => 'YES',
        AmenityCheck.no => 'NO',
        AmenityCheck.partial => 'PARTIAL',
      };

  String get label => switch (this) {
        AmenityCheck.yes => 'Yes',
        AmenityCheck.no => 'No',
        AmenityCheck.partial => 'Partial',
      };

  static AmenityCheck fromApi(String value) => switch (value) {
        'YES' => AmenityCheck.yes,
        'NO' => AmenityCheck.no,
        'PARTIAL' => AmenityCheck.partial,
        _ => throw ArgumentError('Unknown AmenityCheck: $value'),
      };
}

/// The agent's overall recommendation (mirrors the shared `InspectionRecommendation`).
enum InspectionRecommendation {
  approve,
  approveWithConditions,
  reject;

  String get api => switch (this) {
        InspectionRecommendation.approve => 'APPROVE',
        InspectionRecommendation.approveWithConditions => 'APPROVE_WITH_CONDITIONS',
        InspectionRecommendation.reject => 'REJECT',
      };

  String get label => switch (this) {
        InspectionRecommendation.approve => 'Approve',
        InspectionRecommendation.approveWithConditions => 'Approve with conditions',
        InspectionRecommendation.reject => 'Reject',
      };

  static InspectionRecommendation fromApi(String value) => switch (value) {
        'APPROVE' => InspectionRecommendation.approve,
        'APPROVE_WITH_CONDITIONS' => InspectionRecommendation.approveWithConditions,
        'REJECT' => InspectionRecommendation.reject,
        _ => throw ArgumentError('Unknown InspectionRecommendation: $value'),
      };
}

/// A fixed checklist template so the UI is concrete. The server accepts an
/// arbitrary keyed map; these are the keys the agent app fills.
abstract final class InspectionChecklist {
  /// The photo-required amenity checks (design: "8 checks").
  static const amenities = <String>[
    'WiFi',
    'Hot water',
    'Power backup',
    'Drinking water',
    'Housekeeping',
    'Parking',
    'Lift',
    'Kitchen',
  ];

  /// Cleanliness scored 1–5 per area.
  static const cleanlinessAreas = <String>['Rooms', 'Bathrooms', 'Kitchen', 'Common areas'];

  /// Security infrastructure present/absent.
  static const securityItems = <String>[
    'CCTV',
    'Fire extinguisher',
    'Main gate lock',
    'Security guard',
    'Emergency exit',
  ];
}

/// One inspection photo — the private object key is never returned, only the
/// geotag + capture time the agent recorded (mirrors `InspectionPhotoDto`).
class InspectionPhoto {
  final String id;
  final double lat;
  final double lng;
  final DateTime takenAt;

  const InspectionPhoto({required this.id, required this.lat, required this.lng, required this.takenAt});

  factory InspectionPhoto.fromJson(Map<String, dynamic> json) => InspectionPhoto(
        id: json['id'] as String,
        lat: (json['lat'] as num).toDouble(),
        lng: (json['lng'] as num).toDouble(),
        takenAt: DateTime.parse(json['takenAt'] as String),
      );
}

/// A property inspection (draft or submitted). The structured checklist fields are
/// nullable while it is a resumable DRAFT (mirrors the shared `Inspection`).
class Inspection {
  final String id;
  final String visitId;
  final String listingId;
  final String status; // DRAFT / SUBMITTED / APPROVED / REJECTED
  final Map<String, AmenityCheck>? amenities;
  final int? roomCountListed;
  final int? roomCountActual;
  final Map<String, int>? cleanliness;
  final Map<String, bool>? securityInfra;
  final String? discrepancies;
  final InspectionRecommendation? recommendation;
  final String? notesForAdmin;
  final int photoCount;
  final List<InspectionPhoto> photos;
  final DateTime? submittedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Inspection({
    required this.id,
    required this.visitId,
    required this.listingId,
    required this.status,
    required this.amenities,
    required this.roomCountListed,
    required this.roomCountActual,
    required this.cleanliness,
    required this.securityInfra,
    required this.discrepancies,
    required this.recommendation,
    required this.notesForAdmin,
    required this.photoCount,
    required this.photos,
    required this.submittedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isDraft => status == 'DRAFT';
  bool get isSubmitted => status != 'DRAFT';

  factory Inspection.fromJson(Map<String, dynamic> json) => Inspection(
        id: json['id'] as String,
        visitId: json['visitId'] as String,
        listingId: json['listingId'] as String,
        status: json['status'] as String,
        amenities: _amenityMap(json['amenities']),
        roomCountListed: json['roomCountListed'] == null ? null : (json['roomCountListed'] as num).toInt(),
        roomCountActual: json['roomCountActual'] == null ? null : (json['roomCountActual'] as num).toInt(),
        cleanliness: _intMap(json['cleanliness']),
        securityInfra: _boolMap(json['securityInfra']),
        discrepancies: json['discrepancies'] as String?,
        recommendation: json['recommendation'] == null
            ? null
            : InspectionRecommendation.fromApi(json['recommendation'] as String),
        notesForAdmin: json['notesForAdmin'] as String?,
        photoCount: (json['photoCount'] as num).toInt(),
        photos: (json['photos'] as List<dynamic>? ?? const [])
            .map((e) => InspectionPhoto.fromJson(e as Map<String, dynamic>))
            .toList(),
        submittedAt: json['submittedAt'] == null ? null : DateTime.parse(json['submittedAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );

  static Map<String, AmenityCheck>? _amenityMap(dynamic raw) {
    if (raw is! Map) return null;
    return raw.map((k, v) => MapEntry(k as String, AmenityCheck.fromApi(v as String)));
  }

  static Map<String, int>? _intMap(dynamic raw) {
    if (raw is! Map) return null;
    return raw.map((k, v) => MapEntry(k as String, (v as num).toInt()));
  }

  static Map<String, bool>? _boolMap(dynamic raw) {
    if (raw is! Map) return null;
    return raw.map((k, v) => MapEntry(k as String, v as bool));
  }
}

/// Pure submit-gate logic, unit-tested independently of any UI. An inspection can
/// be submitted ONLY when a valid GPS check-in exists, at least
/// [kMinInspectionPhotos] geotagged photos are attached, and the required fields
/// are present. The backend enforces the same three gates; this mirrors them so
/// the button reflects reality (and never lets the agent hit a guaranteed 4xx).
abstract final class InspectionGate {
  static bool canSubmit({
    required bool hasValidCheckIn,
    required int photoCount,
    required bool hasRequiredFields,
  }) =>
      hasValidCheckIn && photoCount >= kMinInspectionPhotos && hasRequiredFields;

  /// Human-readable reasons the inspection cannot yet be submitted (empty ⇒ ready).
  static List<String> blockers({
    required bool hasValidCheckIn,
    required int photoCount,
    required List<String> missingFields,
  }) {
    final reasons = <String>[];
    if (!hasValidCheckIn) reasons.add('A valid GPS check-in (within 200m) is required.');
    if (photoCount < kMinInspectionPhotos) {
      reasons.add('Add ${kMinInspectionPhotos - photoCount} more photo(s) '
          '($photoCount of $kMinInspectionPhotos).');
    }
    for (final f in missingFields) {
      reasons.add('Fill in: $f.');
    }
    return reasons;
  }
}
