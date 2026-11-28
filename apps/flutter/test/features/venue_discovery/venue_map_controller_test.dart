import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_viewport.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_map_controller.dart';

void main() {
  const firstViewport = VenueViewport(
    south: 37.7,
    west: -122.5,
    north: 37.8,
    east: -122.4,
  );
  const secondViewport = VenueViewport(
    south: 40.7,
    west: -74.1,
    north: 40.8,
    east: -73.9,
  );

  group('VenueMapController', () {
    test('passes the current viewport bounds to the venue query', () async {
      VenueViewport? requestedViewport;
      final controller = VenueMapController(
        debounceDuration: const Duration(days: 1),
        fetchVenues: (viewport) async {
          requestedViewport = viewport;
          return const [];
        },
      );
      addTearDown(controller.dispose);

      controller.updateViewport(firstViewport, zoom: 12);
      await controller.refreshNow();

      expect(requestedViewport, same(firstViewport));
      expect(controller.viewport, same(firstViewport));
      expect(controller.zoom, 12);
    });

    test('debounces viewport updates after pan and zoom changes', () async {
      final requested = <VenueViewport>[];
      final controller = VenueMapController(
        debounceDuration: const Duration(milliseconds: 25),
        fetchVenues: (viewport) async {
          requested.add(viewport);
          return const [];
        },
      );
      addTearDown(controller.dispose);

      controller.updateViewport(firstViewport, zoom: 8);
      await Future<void>.delayed(const Duration(milliseconds: 10));
      controller.updateViewport(secondViewport, zoom: 11);
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(requested, [secondViewport]);
      expect(controller.zoom, 11);
    });

    test('consolidates rapid camera changes into one latest query', () async {
      final requested = <VenueViewport>[];
      final controller = VenueMapController(
        debounceDuration: const Duration(milliseconds: 30),
        fetchVenues: (viewport) async {
          requested.add(viewport);
          return const [];
        },
      );
      addTearDown(controller.dispose);

      for (var index = 0; index < 8; index++) {
        controller.updateViewport(
          VenueViewport(
            south: index.toDouble(),
            west: index.toDouble(),
            north: (index + 1).toDouble(),
            east: (index + 1).toDouble(),
          ),
          zoom: index.toDouble(),
        );
        await Future<void>.delayed(const Duration(milliseconds: 3));
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(requested, hasLength(1));
      expect(requested.single.south, 7);
      expect(requested.single.east, 8);
    });

    test('disposal cancels a pending debounced query', () async {
      var fetchCount = 0;
      final controller = VenueMapController(
        debounceDuration: const Duration(milliseconds: 25),
        fetchVenues: (_) async {
          fetchCount++;
          return const [];
        },
      );

      controller.updateViewport(firstViewport, zoom: 9);
      controller.dispose();
      await Future<void>.delayed(const Duration(milliseconds: 50));

      expect(fetchCount, 0);
    });

    test('selects individual markers and clusters', () {
      final firstVenue = _venue(
        id: 'venue-1',
        latitude: 37.7749,
        longitude: -122.4194,
      );
      final nearbyVenue = _venue(
        id: 'venue-2',
        latitude: 37.775,
        longitude: -122.4195,
      );
      final controller = VenueMapController(
        fetchVenues: (_) async => const [],
      );
      addTearDown(controller.dispose);

      controller.selectVenue(firstVenue);
      expect(controller.selectedVenues, [firstVenue]);
      expect(controller.hasSelection, isTrue);

      controller.selectCluster([firstVenue, nearbyVenue]);
      expect(controller.selectedVenues, [firstVenue, nearbyVenue]);
      expect(controller.hasSelection, isTrue);

      final clusters = VenueMapController.clusterVenues(
        [firstVenue, nearbyVenue],
        zoom: 10,
      );
      expect(clusters, hasLength(1));
      expect(clusters.single.isCluster, isTrue);
      expect(clusters.single.venues, hasLength(2));

      controller.clearSelection();
      expect(controller.selectedVenues, isEmpty);
      expect(controller.hasSelection, isFalse);
    });

    test('does not publish stale results when a newer viewport query wins',
        () async {
      final firstResponse = Completer<List<VenueSummary>>();
      final queried = <VenueViewport>[];
      final controller = VenueMapController(
        debounceDuration: const Duration(days: 1),
        fetchVenues: (viewport) {
          queried.add(viewport);
          if (viewport == firstViewport) {
            return firstResponse.future;
          }
          return Future.value([_venue(id: 'latest')]);
        },
      );
      addTearDown(controller.dispose);

      controller.updateViewport(firstViewport, zoom: 8);
      final firstQuery = controller.refreshNow();
      controller.updateViewport(secondViewport, zoom: 10);
      await controller.refreshNow();
      firstResponse.complete([_venue(id: 'stale')]);
      await firstQuery;

      expect(queried, [firstViewport, secondViewport]);
      expect(controller.venues.single.id, 'latest');
    });
  });
}

VenueSummary _venue({
  required String id,
  double? latitude,
  double? longitude,
}) {
  return VenueSummary(
    id: id,
    name: id,
    latitude: latitude,
    longitude: longitude,
  );
}
