import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StoredTokens {
  final String access;
  final String refresh;
  const StoredTokens(this.access, this.refresh);
}

/// Tokens live ONLY in OS-backed secure storage (Keystore / Keychain) — never
/// in plain SharedPreferences (see /CLAUDE.md secrets rule).
class SecureTokenStore {
  final FlutterSecureStorage _storage;

  SecureTokenStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
            );

  static const _accessKey = 'roomadda.access_token';
  static const _refreshKey = 'roomadda.refresh_token';

  Future<void> save(String access, String refresh) async {
    await _storage.write(key: _accessKey, value: access);
    await _storage.write(key: _refreshKey, value: refresh);
  }

  Future<StoredTokens?> read() async {
    final access = await _storage.read(key: _accessKey);
    final refresh = await _storage.read(key: _refreshKey);
    if (access == null || refresh == null) return null;
    return StoredTokens(access, refresh);
  }

  Future<void> clear() async {
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
