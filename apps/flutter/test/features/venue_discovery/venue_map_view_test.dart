import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worksphere_app/features/venue_discovery/data/venue_discovery_repository.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_amenity_filter_controller.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_map_view.dart';

void main() {
  group('VenueMapView lifecycle', () {
    testWidgets('disposes controller and listeners cleanly on route pop',
        (tester) async {
      final repository = VenueDiscoveryRepository(
        baseUri: Uri.parse('https://worksphere.app'),
        client: MockClient((_) async => http.Response('{"venues":[]}', 200)),
      );
      final amenityFilterController = VenueAmenityFilterController();
      addTearDown(amenityFilterController.dispose);

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => Scaffold(
                          body: VenueMapView(
                            repository: repository,
                            amenityFilterController: amenityFilterController,
                            styleUrl: '',
                          ),
                        ),
                      ),
                    );
                  },
                  child: const Text('Open map'),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Open map'));
      await tester.pumpAndSettle();

      expect(find.byType(VenueMapView), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.byType(VenueMapView), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
