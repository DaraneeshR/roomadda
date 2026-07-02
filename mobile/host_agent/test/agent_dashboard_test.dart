import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:roomadda_host_agent/features/agent/dashboard/application/dashboard_controller.dart';
import 'package:roomadda_host_agent/features/agent/dashboard/data/agent_dashboard_repository.dart';
import 'package:roomadda_host_agent/features/agent/dashboard/domain/agent_dashboard.dart';

Map<String, dynamic> _dashJson({int pending = 2, int closed = 5, List<dynamic>? visits}) => {
      'todaysVisits': visits ??
          [
            {
              'id': 'v1',
              'listingId': 'l1',
              'alias': 'Sunrise PG',
              'actualName': 'Sunrise Residency',
              'areaLabel': 'Koramangala',
              'city': 'Bengaluru',
              'fullAddress': '12 Main Rd',
              'latitude': 12.9,
              'longitude': 77.6,
              'status': 'SCHEDULED',
              'scheduledAt': '2026-07-01T09:30:00.000Z',
              'visitedAt': null,
              'notes': null,
              'checkIn': null,
              'inspectionStatus': null,
            },
          ],
      'pendingAssistedBookings': pending,
      'closedThisMonth': closed,
      'generatedAt': '2026-07-01T08:00:00.000Z',
    };

/// A fake repo scripting the next fetch result (a dashboard, or an error to throw).
class _ScriptedDashRepo extends AgentDashboardRepository {
  _ScriptedDashRepo() : super(Dio());

  Object? next;

  @override
  Future<AgentDashboard> fetch() async {
    final n = next;
    if (n is AgentDashboard) return n;
    throw n as Object;
  }
}

DioException _offline() => DioException(
      requestOptions: RequestOptions(path: '/v1/agent/dashboard'),
      type: DioExceptionType.connectionError,
      error: 'no signal',
    );

DioException _serverError() => DioException(
      requestOptions: RequestOptions(path: '/v1/agent/dashboard'),
      type: DioExceptionType.badResponse,
      response: Response(
        requestOptions: RequestOptions(path: '/v1/agent/dashboard'),
        statusCode: 500,
        data: {
          'error': {'code': 'INTERNAL', 'message': 'boom'}
        },
      ),
    );

void main() {
  group('AgentDashboard.fromJson (endpoint shape parses)', () {
    test('parses counts + today\'s visits', () {
      final d = AgentDashboard.fromJson(_dashJson(pending: 3, closed: 7));
      expect(d.pendingAssistedBookings, 3);
      expect(d.closedThisMonth, 7);
      expect(d.todaysVisits, hasLength(1));
      expect(d.todaysVisits.first.actualName, 'Sunrise Residency');
      expect(d.visitsRemaining, 1);
      expect(d.visitsDoneToday, 0);
    });
  });

  group('offline cache serves last-synced data', () {
    test('a dropped fetch keeps the last-synced dashboard behind the offline flag', () async {
      final repo = _ScriptedDashRepo();
      final controller = AgentDashboardController(repo);

      // 1) First load succeeds → fresh data, not from cache.
      repo.next = AgentDashboard.fromJson(_dashJson(closed: 5));
      await controller.load();
      expect(controller.state.data, isNotNull);
      expect(controller.state.data!.closedThisMonth, 5);
      expect(controller.state.fromCache, isFalse);
      expect(controller.state.error, isNull);

      // 2) The signal drops → the last-synced dashboard is still served, flagged stale.
      repo.next = _offline();
      await controller.refresh();
      expect(controller.state.data, isNotNull);
      expect(controller.state.data!.closedThisMonth, 5); // last-synced value
      expect(controller.state.fromCache, isTrue);
      expect(controller.state.error, isNull); // never blanks / crashes
    });

    test('a real server error with nothing cached surfaces an error (not offline)', () async {
      final repo = _ScriptedDashRepo()..next = _serverError();
      final controller = AgentDashboardController(repo);
      await controller.load();
      expect(controller.state.data, isNull);
      expect(controller.state.error, isNotNull);
      expect(controller.state.fromCache, isFalse);
    });
  });
}
