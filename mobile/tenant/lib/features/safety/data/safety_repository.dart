import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:roomadda_core/roomadda_core.dart';

import '../domain/trusted_contact.dart';

/// Talks to the safety endpoints: trusted-contact CRUD and SOS. SOS coordinates
/// are optional — the server still SMSes contacts + alerts admin without a fix,
/// so it works on poor connectivity / denied location.
class SafetyRepository {
  final Dio _dio;
  SafetyRepository(this._dio);

  Future<TrustedContactsView> fetchContacts() async {
    final res = await _dio.get<dynamic>('/v1/trusted-contacts');
    return TrustedContactsView.fromJson(res.data as Map<String, dynamic>);
  }

  Future<TrustedContact> addContact({required String name, required String phone}) async {
    final res = await _dio.post<dynamic>('/v1/trusted-contacts', data: {'name': name, 'phone': phone});
    return TrustedContact.fromJson((res.data as Map<String, dynamic>)['contact'] as Map<String, dynamic>);
  }

  Future<void> removeContact(String id) async {
    await _dio.delete<dynamic>('/v1/trusted-contacts/$id');
  }

  /// Trigger SOS. Sends coordinates when available; the server SMSes every
  /// trusted contact with the location AND alerts admin.
  Future<SosResult> triggerSos({double? lat, double? lng}) async {
    final res = await _dio.post<dynamic>('/v1/sos', data: {
      if (lat != null) 'lat': lat,
      if (lng != null) 'lng': lng,
    });
    return SosResult.fromJson(res.data as Map<String, dynamic>);
  }
}

final safetyRepositoryProvider = Provider<SafetyRepository>((ref) => SafetyRepository(ref.read(dioProvider)));
