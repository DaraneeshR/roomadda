import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:roomadda_host_agent/features/agent/common/agent_location.dart';
import 'package:roomadda_host_agent/features/agent/visits/application/check_in_controller.dart';
import 'package:roomadda_host_agent/features/agent/visits/data/agent_visit_repository.dart';
import 'package:roomadda_host_agent/features/agent/visits/domain/agent_visit.dart';

/// Fake location that returns a scripted result (fix or failure).
class _FakeLocation implements LocationService {
  _FakeLocation(this._result);
  final LocationResult _result;
  @override
  Future<LocationResult> current({Duration timeout = const Duration(seconds: 12)}) async => _result;
}

Position _pos(double lat, double lng) => Position(
      latitude: lat,
      longitude: lng,
      timestamp: DateTime(2026),
      accuracy: 8,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 0,
    );

/// Fake repo scripting the server's check-in verdict (or an error).
class _FakeVisitRepo extends AgentVisitRepository {
  _FakeVisitRepo(this._result) : super(Dio());
  final Object _result; // CheckInResult or an Exception
  int calls = 0;

  @override
  Future<CheckInResult> checkIn(String visitId, {required double lat, required double lng, double? accuracyMeters}) async {
    calls++;
    final r = _result;
    if (r is CheckInResult) return r;
    throw r;
  }
}

CheckInResult _verdict({required bool within}) => CheckInResult(
      visitId: 'v1',
      withinRange: within,
      cannotReachProperty: !within,
      distanceM: within ? 40 : 3200,
      radiusM: 200,
      checkedInAt: DateTime(2026),
    );

void main() {
  test('a within-range fix posts and yields a valid check-in (server verdict)', () async {
    final repo = _FakeVisitRepo(_verdict(within: true));
    final c = CheckInController(_FakeLocation(LocationResult.success(_pos(12.9, 77.6))), repo, 'v1', () async {});

    await c.start();

    expect(c.state, isA<CheckInDone>());
    expect((c.state as CheckInDone).result.withinRange, isTrue);
    expect(repo.calls, 1);
  });

  test('an out-of-range fix is recorded but NOT valid (cannot-reach flag path)', () async {
    final repo = _FakeVisitRepo(_verdict(within: false));
    final c = CheckInController(_FakeLocation(LocationResult.success(_pos(12.5, 77.2))), repo, 'v1', () async {});

    await c.start();

    expect(c.state, isA<CheckInDone>());
    final result = (c.state as CheckInDone).result;
    expect(result.withinRange, isFalse);
    expect(result.cannotReachProperty, isTrue);
  });

  test('a denied location permission is handled gracefully — no post, no crash', () async {
    final repo = _FakeVisitRepo(_verdict(within: true));
    final c = CheckInController(
      _FakeLocation(const LocationResult.failed(LocationFailure.permissionDenied)),
      repo,
      'v1',
      () async {},
    );

    await c.start();

    expect(c.state, isA<CheckInLocationBlocked>());
    expect((c.state as CheckInLocationBlocked).failure, LocationFailure.permissionDenied);
    expect(repo.calls, 0); // never posts without a fix
  });

  test('a failed submit surfaces a retryable error, never a crash', () async {
    final repo = _FakeVisitRepo(
      DioException(requestOptions: RequestOptions(path: '/check-in'), type: DioExceptionType.connectionError),
    );
    final c = CheckInController(_FakeLocation(LocationResult.success(_pos(12.9, 77.6))), repo, 'v1', () async {});

    await c.start();

    expect(c.state, isA<CheckInFailed>());
  });
}
