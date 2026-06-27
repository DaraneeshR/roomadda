enum UserRole {
  tenant,
  host,
  agent,
  admin;

  static UserRole fromApi(String value) => switch (value) {
        'HOST' => UserRole.host,
        'AGENT' => UserRole.agent,
        'ADMIN' => UserRole.admin,
        _ => UserRole.tenant,
      };
}

class SelfUser {
  final String id;
  final UserRole role;
  final String phone;
  final String fullName;

  const SelfUser({
    required this.id,
    required this.role,
    required this.phone,
    required this.fullName,
  });

  factory SelfUser.fromJson(Map<String, dynamic> json) => SelfUser(
        id: json['id'] as String,
        role: UserRole.fromApi(json['role'] as String),
        phone: json['phone'] as String,
        fullName: (json['fullName'] as String?) ?? '',
      );
}
