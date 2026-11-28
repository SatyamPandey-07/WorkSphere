import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:maplibre_gl/maplibre_gl.dart';
import 'package:worksphere_app/features/venue_discovery/data/venue_discovery_repository.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_viewport.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_amenity_filter_controller.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_map_controller.dart';

const String _defaultMapStyle =
    'https://tiles.openfreemap.org/styles/liberty';

class VenueMapView extends StatefulWidget {
  const VenueMapView({
    super.key,
    required this.repository,
    required this.amenityFilterController,
    this.category,
    this.styleUrl = const String.fromEnvironment(
      'WORKSPHERE_MAP_STYLE_URL',
      defaultValue: _defaultMapStyle,
    ),
    this.debounceDuration = const Duration(milliseconds: 350),
  });

  final VenueDiscoveryRepository repository;
  final VenueAmenityFilterController amenityFilterController;
  final String? category;
  final String styleUrl;
  final Duration debounceDuration;

  @override
  State<VenueMapView> createState() => _VenueMapViewState();
}

class _VenueMapViewState extends State<VenueMapView> {
  late VenueMapController _venueMapController;
  MapLibreMapController? _mapController;
  VenueViewport? _visibleViewport;
  String? _mapError;

  @override
  void initState() {
    super.initState();
    _createVenueMapController();
  }

  void _createVenueMapController() {
    _venueMapController = VenueMapController(
      debounceDuration: widget.debounceDuration,
      fetchVenues: (viewport) => widget.repository.fetchVenuesInViewport(
        viewport: viewport,
        category: widget.category,
      ),
    )..addListener(_onVenueMapChanged);
  }

  @override
  void didUpdateWidget(covariant VenueMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repository != widget.repository ||
        oldWidget.category != widget.category ||
        oldWidget.debounceDuration != widget.debounceDuration) {
      _venueMapController
        ..removeListener(_onVenueMapChanged)
        ..dispose();
      _createVenueMapController();
      final viewport = _visibleViewport;
      if (viewport != null) {
        _venueMapController.updateViewport(
          viewport,
          zoom: _venueMapController.zoom,
        );
      }
    }
  }

  void _onVenueMapChanged() {
    if (mounted) {
      setState(() {});
    }
  }

  void _onMapCreated(MapLibreMapController mapController) {
    _mapController = mapController;
    _refreshVisibleViewport();
  }

  Future<void> _refreshVisibleViewport() async {
    final mapController = _mapController;
    if (mapController == null) {
      return;
    }

    try {
      final bounds = await mapController.getVisibleRegion();
      final camera = await mapController.getCameraPosition();
      if (!mounted || mapController != _mapController) {
        return;
      }
      final viewport = VenueViewport(
        south: bounds.southwest.latitude,
        west: bounds.southwest.longitude,
        north: bounds.northeast.latitude,
        east: bounds.northeast.longitude,
      );
      setState(() {
        _visibleViewport = viewport;
        _mapError = null;
      });
      _venueMapController.updateViewport(viewport, zoom: camera.zoom);
    } catch (_) {
      if (mounted) {
        setState(() {
          _mapError = 'Unable to read the visible map area.';
        });
      }
    }
  }

  void _selectCluster(VenueMapCluster cluster) {
    if (cluster.isCluster) {
      _venueMapController.selectCluster(cluster.venues);
      final currentZoom = _venueMapController.zoom;
      _mapController?.animateCamera(
        CameraUpdate.newLatLngZoom(
          LatLng(cluster.latitude, cluster.longitude),
          math.min(currentZoom + 2, 18.0).toDouble(),
        ),
      );
    } else {
      _venueMapController.selectVenue(cluster.venues.single);
    }

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _VenuePreviewSheet(
        venues: cluster.venues,
        isCluster: cluster.isCluster,
      ),
    ).whenComplete(_venueMapController.clearSelection);
  }

  @override
  void dispose() {
    _venueMapController
      ..removeListener(_onVenueMapChanged)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.styleUrl.trim().isEmpty) {
      return const _MapUnavailable(
        message: 'Map configuration is unavailable. Please try again later.',
      );
    }

    return Stack(
      fit: StackFit.expand,
      children: [
        MapLibreMap(
          styleString: widget.styleUrl,
          initialCameraPosition: const CameraPosition(
            target: LatLng(20, 0),
            zoom: 2,
          ),
          onMapCreated: _onMapCreated,
          onCameraIdle: _refreshVisibleViewport,
          compassEnabled: true,
          rotateGesturesEnabled: true,
          tiltGesturesEnabled: false,
          zoomGesturesEnabled: true,
          scrollGesturesEnabled: true,
        ),
        if (_visibleViewport case final viewport?)
          LayoutBuilder(
            builder: (context, constraints) {
              return Stack(
                children: [
                  for (final cluster in VenueMapController.clusterVenues(
                    widget.amenityFilterController
                        .filterVenues(_venueMapController.venues),
                    zoom: _venueMapController.zoom,
                  ))
                    _buildClusterMarker(cluster, viewport, constraints.biggest),
                ],
              );
            },
          ),
        Positioned(
          top: 12,
          left: 12,
          right: 12,
          child: _buildMapStatus(),
        ),
      ],
    );
  }

  Widget _buildClusterMarker(
    VenueMapCluster cluster,
    VenueViewport viewport,
    Size size,
  ) {
    final position = _screenPosition(
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      viewport: viewport,
      size: size,
    );
    if (position == null) {
      return const SizedBox.shrink();
    }

    return Positioned(
      left: position.dx - 22,
      top: position.dy - 22,
      child: Semantics(
        button: true,
        label: cluster.isCluster
            ? '${cluster.venues.length} venues in this area'
            : cluster.venues.single.name,
        child: GestureDetector(
          onTap: () => _selectCluster(cluster),
          child: Container(
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: cluster.isCluster
                  ? Theme.of(context).colorScheme.primary
                  : Theme.of(context).colorScheme.surface,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: Theme.of(context).colorScheme.primary,
                width: 2,
              ),
              boxShadow: const [
                BoxShadow(color: Colors.black26, blurRadius: 6),
              ],
            ),
            alignment: Alignment.center,
            child: cluster.isCluster
                ? Text(
                    '${cluster.venues.length}',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onPrimary,
                      fontWeight: FontWeight.bold,
                    ),
                  )
                : Icon(
                    Icons.location_on,
                    color: Theme.of(context).colorScheme.primary,
                  ),
          ),
        ),
      ),
    );
  }

  Widget _buildMapStatus() {
    if (_mapError != null) {
      return _MapStatusCard(
        message: _mapError!,
        actionLabel: 'Retry',
        onAction: _refreshVisibleViewport,
      );
    }
    if (_venueMapController.isLoading) {
      return const _MapStatusCard(
        message: 'Loading venues in this area…',
        showProgress: true,
      );
    }
    if (_venueMapController.errorMessage != null) {
      return _MapStatusCard(
        message: _venueMapController.errorMessage!,
        actionLabel: 'Retry',
        onAction: _venueMapController.refreshNow,
      );
    }
    if (_visibleViewport != null &&
        widget.amenityFilterController
            .filterVenues(_venueMapController.venues)
            .isEmpty) {
      return const _MapStatusCard(message: 'No venues found in this area.');
    }
    return const SizedBox.shrink();
  }

  Offset? _screenPosition({
    required double latitude,
    required double longitude,
    required VenueViewport viewport,
    required Size size,
  }) {
    final west = _mercatorX(viewport.west);
    var east = _mercatorX(viewport.east);
    var pointX = _mercatorX(longitude);
    if (east < west) {
      east += 1;
    }
    if (pointX < west) {
      pointX += 1;
    }

    final north = _mercatorY(viewport.north);
    final south = _mercatorY(viewport.south);
    final pointY = _mercatorY(latitude);
    final width = east - west;
    final height = south - north;
    if (width <= 0 || height <= 0) {
      return null;
    }

    final x = (pointX - west) / width * size.width;
    final y = (pointY - north) / height * size.height;
    if (x < 0 || x > size.width || y < 0 || y > size.height) {
      return null;
    }
    return Offset(x, y);
  }

  double _mercatorX(double longitude) => (longitude + 180) / 360;

  double _mercatorY(double latitude) {
    final safeLatitude = latitude.clamp(-85.0511, 85.0511);
    final sinLatitude = math.sin(safeLatitude * math.pi / 180);
    return 0.5 -
        math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * math.pi);
  }
}

class _VenuePreviewSheet extends StatelessWidget {
  const _VenuePreviewSheet({
    required this.venues,
    required this.isCluster,
  });

  final List<VenueSummary> venues;
  final bool isCluster;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 360),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                isCluster ? '${venues.length} nearby venues' : 'Venue preview',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: venues.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final venue = venues[index];
                  return ListTile(
                    leading: const CircleAvatar(
                      child: Icon(Icons.storefront_outlined),
                    ),
                    title: Text(venue.name),
                    subtitle: Text(
                      [
                        if (venue.address?.isNotEmpty == true) venue.address!,
                        venue.openStatusLabel,
                        venue.wifiLabel,
                        venue.noiseLabel,
                      ].join(' · '),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MapStatusCard extends StatelessWidget {
  const _MapStatusCard({
    required this.message,
    this.showProgress = false,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final bool showProgress;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            if (showProgress) ...[
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 12),
            ],
            Expanded(child: Text(message)),
            if (actionLabel != null && onAction != null)
              TextButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ),
      ),
    );
  }
}

class _MapUnavailable extends StatelessWidget {
  const _MapUnavailable({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.map_outlined, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
  }
}
