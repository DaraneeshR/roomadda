import 'package:dio/dio.dart';
import 'models.dart';

class AuthSession {
  final String accessToken;
  final String refreshToken;
  final SelfUser user;
  const AuthSession(this.accessToken, this.refreshToken, this.user);
}

class AuthRepository {
  final Dio _dio;

  /// Which app this build is (`tenant` | `host_agent`), sent on verify so the
  /// server can reject a number whose role this app doesn't serve.
  final String appAudience;

  AuthRepository(this._dio, {required this.appAudience});

  Future<void> requestOtp(String phone) async {
    await _dio.post<dynamic>('/v1/auth/otp/request', data: {'phone': phone});
  }

  /// Mobile client: the refresh token is returned in the body (stored securely).
  Future<AuthSession> verifyOtp(String phone, String code) async {
    final res = await _dio.post<dynamic>(
      '/v1/auth/otp/verify',
      data: {'phone': phone, 'code': code, 'client': 'mobile', 'appAudience': appAudience},
    );
    final data = res.data as Map<String, dynamic>;
    return AuthSession(
      data['accessToken'] as String,
      data['refreshToken'] as String,
      SelfUser.fromJson(data['user'] as Map<String, dynamic>),
    );
  }

  Future<SelfUser> me() async {
    final res = await _dio.get<dynamic>('/v1/me');
    final data = res.data as Map<String, dynamic>;
    return SelfUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    await _dio.post<dynamic>('/v1/auth/logout', data: <String, dynamic>{});
  }
}
