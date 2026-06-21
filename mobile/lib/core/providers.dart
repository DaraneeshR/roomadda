import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth/auth_controller.dart';
import 'auth/auth_repository.dart';
import 'auth/auth_state.dart';
import 'auth/secure_token_store.dart';
import 'auth/session_manager.dart';
import 'config/env.dart';
import 'network/auth_interceptor.dart';
import 'network/error_interceptor.dart';

// Explicit variable types break the analyzer's top-level inference cycle
// (dio -> authController -> authRepository -> dio). The runtime cycle is already
// broken because onLoggedOut is a lazy closure.
final Provider<SecureTokenStore> secureTokenStoreProvider =
    Provider<SecureTokenStore>((ref) => SecureTokenStore());

final Provider<SessionManager> sessionManagerProvider =
    Provider<SessionManager>((ref) => SessionManager(ref.read(secureTokenStoreProvider)));

final Provider<Dio> dioProvider = Provider<Dio>((ref) {
  final session = ref.read(sessionManagerProvider);
  final dio = Dio(
    BaseOptions(
      baseUrl: Env.apiBaseUrl,
      contentType: Headers.jsonContentType,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
    ),
  );
  dio.interceptors.add(
    AuthInterceptor(
      session: session,
      baseUrl: Env.apiBaseUrl,
      // Lazy: only invoked on a failed refresh, so no provider cycle at creation.
      onLoggedOut: () => ref.read(authControllerProvider.notifier).onSessionExpired(),
    ),
  );
  dio.interceptors.add(ErrorInterceptor());
  return dio;
});

final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>((ref) => AuthRepository(ref.read(dioProvider)));

final StateNotifierProvider<AuthController, AuthState> authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>(
  (ref) => AuthController(ref.read(authRepositoryProvider), ref.read(sessionManagerProvider)),
);
