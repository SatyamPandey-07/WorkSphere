import 'package:flutter_test/flutter_test.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_amenity_filter_controller.dart';

void main() {
  group('VenueAmenityFilterController', () {
    final venues = [
      _venue('quiet', noise: 40),
      _venue('gigabit', wifi: 1200),
      _venue('outlets', outlets: true),
      _venue('all', noise: 35, wifi: 1500, outlets: true),
      _venue('none'),
    ];

    test('filters each individual amenity', () {
      final controller = VenueAmenityFilterController();
      addTearDown(controller.dispose);

      const expectedVenueIds = <VenueAmenity, String>{
        VenueAmenity.quietZone: 'quiet',
        VenueAmenity.gigabitWifi: 'gigabit',
        VenueAmenity.powerOutlets: 'outlets',
      };
      for (final entry in expectedVenueIds.entries) {
        controller.toggle(entry.key);
        expect(
          controller.filterVenues(venues).map((venue) => venue.id),
          containsAll([entry.value, 'all']),
        );
        expect(controller.filterVenues(venues), hasLength(2));
        controller.clear();
      }
    });

    test('combines multiple amenity filters', () {
      final controller = VenueAmenityFilterController();
      addTearDown(controller.dispose);

      controller
        ..toggle(VenueAmenity.quietZone)
        ..toggle(VenueAmenity.gigabitWifi)
        ..toggle(VenueAmenity.powerOutlets);

      expect(
        controller.filterVenues(venues).map((venue) => venue.id),
        ['all'],
      );
    });

    test('clearing filters restores every venue', () {
      final controller = VenueAmenityFilterController();
      addTearDown(controller.dispose);

      controller
        ..toggle(VenueAmenity.gigabitWifi)
        ..clear();

      expect(controller.selectedAmenities, isEmpty);
      expect(controller.filterVenues(venues), venues);
    });

    test('restores selected amenities from URL query parameters', () {
      final controller = VenueAmenityFilterController(
        queryParameters: const {
          'amenities': ['quiet-zone', 'power_outlets'],
        },
      );
      addTearDown(controller.dispose);

      expect(
        controller.selectedAmenities,
        {VenueAmenity.quietZone, VenueAmenity.powerOutlets},
      );
    });

    test('updates query parameters while preserving unrelated values', () {
      final controller = VenueAmenityFilterController();
      addTearDown(controller.dispose);
      const existing = <String, List<String>>{
        'category': ['cafe'],
        'tag': ['study', 'open-late'],
        'amenities': ['unsupported'],
      };

      controller
        ..toggle(VenueAmenity.powerOutlets)
        ..toggle(VenueAmenity.quietZone);

      expect(
        controller.queryParametersForSelection(existing),
        {
          'category': ['cafe'],
          'tag': ['study', 'open-late'],
          'amenities': ['quiet-zone', 'power-outlets'],
        },
      );

      controller.clear();
      expect(
        controller.queryParametersForSelection(existing),
        {
          'category': ['cafe'],
          'tag': ['study', 'open-late'],
        },
      );
    });

    test('supplies identical filtered results to list and map consumers', () {
      final controller = VenueAmenityFilterController();
      addTearDown(controller.dispose);
      controller
        ..toggle(VenueAmenity.quietZone)
        ..toggle(VenueAmenity.gigabitWifi);

      final listResults = controller.filterVenues(venues);
      final mapResults = controller.filterVenues(venues);

      expect(mapResults, listResults);
      expect(listResults.map((venue) => venue.id), ['all']);
    });

    test('ignores unsupported values and deduplicates query values', () {
      final controller = VenueAmenityFilterController(
        queryParameters: const {
          'amenities': [
            'quiet-zone',
            'quiet-zone',
            'unsupported',
            'gigabit-wifi',
          ],
        },
      );
      addTearDown(controller.dispose);

      expect(
        controller.selectedAmenities,
        {VenueAmenity.quietZone, VenueAmenity.gigabitWifi},
      );
    });
  });
}

VenueSummary _venue(
  String id, {
  double? noise,
  double? wifi,
  bool? outlets,
}) {
  return VenueSummary(
    id: id,
    name: id,
    avgNoiseLevel: noise,
    avgWifiSpeed: wifi,
    hasPowerOutlets: outlets,
  );
}
