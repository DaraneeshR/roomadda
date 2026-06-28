import 'package:flutter/material.dart';

/// Maps an amenity label (as the API stores it) to a Material icon. Unknown
/// amenities fall back to a neutral dot so we never crash on new values.
IconData amenityIcon(String amenity) {
  switch (amenity.toLowerCase().trim()) {
    case 'wifi':
    case 'wi-fi':
      return Icons.wifi;
    case 'ac':
    case 'air conditioning':
      return Icons.ac_unit;
    case 'geyser':
    case 'hot water':
      return Icons.hot_tub;
    case 'laundry':
      return Icons.local_laundry_service;
    case 'parking':
      return Icons.local_parking;
    case 'cctv':
      return Icons.videocam;
    case 'power backup':
      return Icons.bolt;
    case 'gym':
      return Icons.fitness_center;
    case 'study table':
      return Icons.desk;
    case 'tv':
      return Icons.tv;
    case 'housekeeping':
      return Icons.cleaning_services;
    case 'lift':
    case 'elevator':
      return Icons.elevator;
    case 'fridge':
      return Icons.kitchen;
    default:
      return Icons.check_circle_outline;
  }
}

/// Human label for a room's sharing type (1 = single, 2 = double, …).
String sharingLabel(int sharingType) => switch (sharingType) {
      1 => 'Single',
      2 => 'Double',
      3 => 'Triple',
      _ => '$sharingType-sharing',
    };

/// Human label for a listing's gender policy.
String genderLabel(String gender) => switch (gender) {
      'MALE' => 'Boys',
      'FEMALE' => 'Girls',
      'COED' => 'Co-ed',
      _ => gender,
    };

/// "1.2 km" from metres; null when distance is unknown (browse results).
String? distanceLabel(int? meters) {
  if (meters == null) return null;
  if (meters < 1000) return '$meters m';
  return '${(meters / 1000).toStringAsFixed(1)} km';
}
