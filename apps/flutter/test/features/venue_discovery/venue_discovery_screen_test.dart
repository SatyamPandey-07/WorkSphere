import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worksphere_app/features/venue_discovery/data/venue_discovery_repository.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_discovery_screen.dart';

void main() {
  group('VenueDiscoveryScreen', () {
    testWidgets('renders loading state then venue cards with badges',
        (tester) async {
      final completer = Completer<http.Response>();
      final client = MockClient((_) => completer.future);
      final repository = VenueDiscoveryRepository(
        baseUri: Uri.parse('https://worksphere.app'),
        client: client,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: VenueDiscoveryScreen(repository: repository),
        ),
      );

      expect(find.byKey(const Key('venue_discovery_loading')), findsOneWidget);

      completer.complete(
        http.Response(
          jsonEncode({
            'venues': [
              {
                'id': 'v-1',
                'name': 'Bandra Quiet Hub',
                'address': '14 Chapel Road, Mumbai',
                'avgWifiSpeed': 185.4,
                'avgNoiseLevel': 42.0,
                'isOpen': true,
              },
              {
                'id': 'v-2',
                'name': 'Lower Parel Roasters',
                'address': 'Kamala Mills',
                'avgWifiSpeed': 75.0,
                'avgNoiseLevel': 72.0,
                'isOpen': false,
              },
            ],
          }),
          200,
        ),
      );

      await tester.pumpAndSettle();

      expect(find.text('Bandra Quiet Hub'), findsOneWidget);
      expect(find.text('185 Mbps'), findsOneWidget);
      expect(find.text('42 dB · Quiet'), findsOneWidget);
      expect(find.text('Open'), findsOneWidget);

      expect(find.text('Lower Parel Roasters'), findsOneWidget);
      expect(find.text('75 Mbps'), findsOneWidget);
      expect(find.text('72 dB · Loud'), findsOneWidget);
      expect(find.text('Closed'), findsOneWidget);
    });

    testWidgets('shows error state and retries on button tap', (tester) async {
      var attempt = 0;
      final client = MockClient((_) async {
        attempt += 1;
        if (attempt == 1) {
          return http.Response('{"error":"upstream"}', 503);
        }
        return http.Response(
          jsonEncode({
            'venues': [
              {
                'id': 'v-3',
                'name': 'Powai Study Loft',
                'avgWifiSpeed': 120,
                'avgNoiseLevel': 55,
                'isOpen': true,
              },
            ],
          }),
          200,
        );
      });

      final repository = VenueDiscoveryRepository(
        baseUri: Uri.parse('https://worksphere.app'),
        client: client,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: VenueDiscoveryScreen(repository: repository),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Unable to load venues'), findsOneWidget);
      await tester.tap(find.byKey(const Key('venue_discovery_retry')));
      await tester.pumpAndSettle();

      expect(find.text('Powai Study Loft'), findsOneWidget);
      expect(attempt, 2);
    });

    testWidgets('supports pull-to-refresh to reload venues', (tester) async {
      var calls = 0;
      final client = MockClient((_) async {
        calls += 1;
        return http.Response(
          jsonEncode({
            'venues': [
              {
                'id': 'v-$calls',
                'name': 'Venue Refresh $calls',
                'avgWifiSpeed': 100,
                'avgNoiseLevel': 45,
                'isOpen': true,
              },
            ],
          }),
          200,
        );
      });

      final repository = VenueDiscoveryRepository(
        baseUri: Uri.parse('https://worksphere.app'),
        client: client,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: VenueDiscoveryScreen(repository: repository),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Venue Refresh 1'), findsOneWidget);

      await tester.fling(find.byType(ListView), const Offset(0, 300), 1000);
      await tester.pumpAndSettle();

      expect(find.text('Venue Refresh 2'), findsOneWidget);
      expect(calls, 2);
    });
  });
}
