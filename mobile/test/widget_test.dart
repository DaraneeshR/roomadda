import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_mobile/core/auth/models.dart';
import 'package:roomadda_mobile/core/money/paise.dart';

void main() {
  test('Paise stores integer paise and formats as Indian currency', () {
    const token = Paise(1200000); // ₹12,000.00
    expect(token.value, 1200000);
    expect(token.format(), contains('12,000'));
  });

  test('Paise.fromRupees rounds to integer paise (no float drift)', () {
    expect(Paise.fromRupees(19.99).value, 1999);
    expect((const Paise(500) + const Paise(250)).value, 750);
  });

  test('UserRole maps from API strings, defaulting to tenant', () {
    expect(UserRole.fromApi('HOST'), UserRole.host);
    expect(UserRole.fromApi('AGENT'), UserRole.agent);
    expect(UserRole.fromApi('ADMIN'), UserRole.admin);
    expect(UserRole.fromApi('TENANT'), UserRole.tenant);
    expect(UserRole.fromApi('something-else'), UserRole.tenant);
  });
}
