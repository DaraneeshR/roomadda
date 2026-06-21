import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../error/crash_reporter.dart';
import 'api_exception.dart';

/// Centralises error handling: maps every DioException to an [ApiException]
/// (attached as `err.error`) and reports unexpected server/network failures.
class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final apiError = mapDioError(err);
    final status = apiError.statusCode ?? 0;

    // Report the unexpected (5xx / transport), not routine 4xx validation/auth.
    if (status == 0 || status >= 500) {
      debugPrint('API error ${apiError.code}: ${apiError.message}');
      CrashReporter.recordError(apiError, err.stackTrace);
    }

    handler.next(err.copyWith(error: apiError));
  }
}
