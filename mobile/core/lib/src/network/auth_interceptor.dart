import 'package:dio/dio.dart';
import '../auth/session_manager.dart';

/// Attaches the access token, transparently refreshes on 401 (single-flight)
/// using the refresh token from secure storage, retries the original request,
/// and logs out when the refresh itself fails.
class AuthInterceptor extends Interceptor {
  final SessionManager session;
  final void Function() onLoggedOut;

  /// Bare dio (no interceptors) used for the refresh + retry so we never recurse.
  final Dio _bareDio;
  Future<bool>? _refreshing;

  AuthInterceptor({
    required this.session,
    required String baseUrl,
    required this.onLoggedOut,
  }) : _bareDio = Dio(BaseOptions(baseUrl: baseUrl, contentType: Headers.jsonContentType));

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = session.accessToken;
    if (token != null && options.extra['skipAuth'] != true) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final isUnauthorized = err.response?.statusCode == 401;
    final isRefreshCall = err.requestOptions.path.contains('/v1/auth/refresh');
    final alreadyRetried = err.requestOptions.extra['retried'] == true;

    if (isUnauthorized && !isRefreshCall && !alreadyRetried) {
      final refreshed = await _refresh();
      if (refreshed) {
        try {
          final response = await _retry(err.requestOptions);
          handler.resolve(response);
          return;
        } catch (_) {
          // fall through and reject with the original error
        }
      } else {
        onLoggedOut();
      }
    }
    handler.next(err);
  }

  Future<bool> _refresh() => _refreshing ??= _performRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _performRefresh() async {
    final refreshToken = session.refreshToken;
    if (refreshToken == null) return false;
    try {
      final res = await _bareDio.post<dynamic>(
        '/v1/auth/refresh',
        data: {'client': 'mobile', 'refreshToken': refreshToken},
      );
      final data = res.data as Map<String, dynamic>;
      final access = data['accessToken'] as String?;
      final newRefresh = data['refreshToken'] as String?;
      if (access == null || newRefresh == null) {
        await session.clear();
        return false;
      }
      await session.save(access, newRefresh);
      return true;
    } on DioException {
      await session.clear();
      return false;
    }
  }

  Future<Response<dynamic>> _retry(RequestOptions options) {
    return _bareDio.request<dynamic>(
      options.path,
      data: options.data,
      queryParameters: options.queryParameters,
      options: Options(
        method: options.method,
        responseType: options.responseType,
        contentType: options.contentType,
        headers: {...options.headers, 'Authorization': 'Bearer ${session.accessToken}'},
        extra: {...options.extra, 'retried': true},
      ),
    );
  }
}
