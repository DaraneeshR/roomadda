import 'package:roomadda_core/roomadda_core.dart';

/// A bookable room from a listing's private detail (`GET /v1/listings/:id`). The
/// agent books by ROOM — the server picks an available bed under a row lock (bed
/// ids are never surfaced). Only rooms with a free bed can take a new booking.
class BookingRoom {
  final String id;
  final String name;
  final String? sharingType;
  final Paise monthlyRent;
  final int availableBeds;

  const BookingRoom({
    required this.id,
    required this.name,
    required this.sharingType,
    required this.monthlyRent,
    required this.availableBeds,
  });

  bool get hasVacancy => availableBeds > 0;

  factory BookingRoom.fromJson(Map<String, dynamic> json) => BookingRoom(
        id: json['id'] as String,
        name: json['name'] as String,
        sharingType: json['sharingType'] as String?,
        monthlyRent: Paise((json['monthlyRentPaise'] as num).toInt()),
        availableBeds: (json['availableBeds'] as num?)?.toInt() ?? 0,
      );
}
