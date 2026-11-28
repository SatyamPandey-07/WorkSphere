import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_viewport.dart';

typedef VenueViewportFetcher = Future<List<VenueSummary>> Function(
  VenueViewport viewport,
);

class VenueMapCluster {
  const VenueMapCluster({
    required this.id,
    required this.venues,
    required this.latitude,
    required this.longitude,
  });

  final String id;
  final List<VenueSummary> venues;
  final double latitude;
  final double longitude;

  bool get isCluster => venues.length > 1;
}

class VenueMapController extends ChangeNotifier {
  VenueMapController({
    required VenueViewportFetcher fetchVenues,
    this.debounceDuration = const Duration(milliseconds: 350),
  }) : _fetchVenues = fetchVenues;

  final VenueViewportFetcher _fetchVenues;
  final Duration debounceDuration;

  Timer? _debounceTimer;
  VenueViewport? _viewport;
  double _zoom = 2;
  List<VenueSummary> _venues = const [];
  List<VenueSummary> _selectedVenues = const [];
  bool _isLoading = false;
  String? _errorMessage;
  int _requestGeneration = 0;
  bool _disposed = false;

  VenueViewport? get viewport => _viewport;
  double get zoom => _zoom;
  List<VenueSummary> get venues => List.unmodifiable(_venues);
  List<VenueSummary> get selectedVenues => List.unmodifiable(_selectedVenues);
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get hasSelection => _selectedVenues.isNotEmpty;

  List<VenueMapCluster> get clusters => clusterVenues(_venues, zoom: _zoom);

  void updateViewport(VenueViewport viewport, {required double zoom}) {
    if (_disposed) {
      return;
    }
    _viewport = viewport;
    _zoom = zoom;
    _debounceTimer?.cancel();
    _debounceTimer = Timer(debounceDuration, () {
      _debounceTimer = null;
      unawaited(_loadViewport(viewport));
    });
  }

  Future<void> refreshNow() async {
    if (_disposed || _viewport == null) {
      return;
    }
    _debounceTimer?.cancel();
    _debounceTimer = null;
    await _loadViewport(_viewport!);
  }

  Future<void> _loadViewport(VenueViewport viewport) async {
    final generation = ++_requestGeneration;
    _isLoading = true;
    _errorMessage = null;
    _notifyIfAlive();

    try {
      final venues = await _fetchVenues(viewport);
      if (_disposed || generation != _requestGeneration) {
        return;
      }
      _venues = venues;
      _isLoading = false;
      _errorMessage = null;
    } catch (_) {
      if (_disposed || generation != _requestGeneration) {
        return;
      }
      _isLoading = false;
      _errorMessage = 'Unable to load venues in this area. Please try again.';
    }
    _notifyIfAlive();
  }

  void selectVenue(VenueSummary venue) {
    if (_disposed) {
      return;
    }
    _selectedVenues = <VenueSummary>[venue];
    notifyListeners();
  }

  void selectCluster(Iterable<VenueSummary> venues) {
    if (_disposed) {
      return;
    }
    _selectedVenues = List<VenueSummary>.unmodifiable(venues);
    notifyListeners();
  }

  void clearSelection() {
    if (_disposed || _selectedVenues.isEmpty) {
      return;
    }
    _selectedVenues = const [];
    notifyListeners();
  }

  static List<VenueMapCluster> clusterVenues(
    Iterable<VenueSummary> venues, {
    required double zoom,
    double cellSize = 52,
  }) {
    final groups = <String, List<VenueSummary>>{};
    final scale = 256 * math.pow(2, zoom);

    for (final venue in venues) {
      final latitude = venue.latitude;
      final longitude = venue.longitude;
      if (latitude == null ||
          longitude == null ||
          latitude < -85.0511 ||
          latitude > 85.0511 ||
          longitude < -180 ||
          longitude > 180) {
        continue;
      }

      final sinLatitude = math.sin(latitude * math.pi / 180);
      final worldX = (longitude + 180) / 360 * scale;
      final worldY = (0.5 -
              math.log((1 + sinLatitude) / (1 - sinLatitude)) /
                  (4 * math.pi)) *
          scale;
      final pointX = worldX / cellSize;
      final pointY = worldY / cellSize;
      final axialQ = math.sqrt(3) / 3 * pointX - pointY / 3;
      final axialR = 2 / 3 * pointY;
      final cubeX = axialQ;
      final cubeZ = axialR;
      final cubeY = -cubeX - cubeZ;
      var roundedX = cubeX.round();
      var roundedY = cubeY.round();
      var roundedZ = cubeZ.round();
      final xDifference = (roundedX - cubeX).abs();
      final yDifference = (roundedY - cubeY).abs();
      final zDifference = (roundedZ - cubeZ).abs();
      if (xDifference > yDifference && xDifference > zDifference) {
        roundedX = -roundedY - roundedZ;
      } else if (yDifference > zDifference) {
        roundedY = -roundedX - roundedZ;
      } else {
        roundedZ = -roundedX - roundedY;
      }
      final key = '$roundedX:$roundedZ';
      groups.putIfAbsent(key, () => <VenueSummary>[]).add(venue);
    }

    return groups.entries.map((entry) {
      final members = List<VenueSummary>.unmodifiable(entry.value);
      final latitude = members
              .map((venue) => venue.latitude!)
              .reduce((a, b) => a + b) /
          members.length;
      final longitude = members
              .map((venue) => venue.longitude!)
              .reduce((a, b) => a + b) /
          members.length;
      return VenueMapCluster(
        id: entry.key,
        venues: members,
        latitude: latitude,
        longitude: longitude,
      );
    }).toList(growable: false);
  }

  void _notifyIfAlive() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _requestGeneration++;
    _debounceTimer?.cancel();
    _debounceTimer = null;
    super.dispose();
  }
}
