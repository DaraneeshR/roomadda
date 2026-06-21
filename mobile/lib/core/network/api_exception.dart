import 'package:dio/dio.dart';

/// Normalised API error surfaced to the app (from the backend's
/// `{ error: { code, message } }` envelope).
class ApiException implements Exception {
  final int? statusCode;
  final String code;
  final String message;

  const ApiException({this.statusCode, required this.code, required this.message});

  @override
  String toString() => 'ApiException($statusCode $code): $message';
}

ApiException mapDioError(DioException err) {
  final data = err.response?.data;
  if (data is Map && data['error'] is Map) {
    final error = data['error'] as Map;
    return ApiException(
      statusCode: err.response?.statusCode,
      code: (error['code'] ?? 'ERROR').toString(),
      message: (error['message'] ?? 'Request failed').toString(),
    );
  }
  return ApiException(
    statusCode: err.response?.statusCode,
    code: 'NETWORK_ERROR',
    message: err.message ?? 'Network error. Please check your connection.',
  );
}

/// Extract an [ApiException] from anything thrown by a dio call.
ApiException apiExceptionFrom(Object error) {
  if (error is DioException) {
    final attached = error.error;
    return attached is ApiException ? attached : mapDioError(error);
  }
  if (error is ApiException) return error;
  return ApiException(code: 'UNKNOWN', message: error.toString());
}
