import 'package:flutter/material.dart';
import 'package:worksphere_app/features/venue_discovery/data/venue_discovery_repository.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';

class VenueDiscoveryScreen extends StatefulWidget {
  const VenueDiscoveryScreen({
    super.key,
    required this.repository,
    this.category,
    this.onVenueTap,
  });

  final VenueDiscoveryRepository repository;
  final String? category;
  final void Function(VenueSummary venue)? onVenueTap;

  @override
  State<VenueDiscoveryScreen> createState() => _VenueDiscoveryScreenState();
}

class _VenueDiscoveryScreenState extends State<VenueDiscoveryScreen> {
  List<VenueSummary> _venues = const [];
  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadVenues();
  }

  Future<void> _loadVenues() async {
    if (!mounted) return;
    setState(() {
      _isLoading = _venues.isEmpty;
      _errorMessage = null;
    });

    try {
      final results = await widget.repository.fetchVenues(
        category: widget.category,
      );
      if (!mounted) return;
      setState(() {
        _venues = results;
        _isLoading = false;
        _errorMessage = null;
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = err.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Discover Venues'),
      ),
      body: _buildBody(context),
    );
  }

  Widget _buildBody(BuildContext context) {
    if (_isLoading) {
      return const Center(
        child: CircularProgressIndicator(
          key: Key('venue_discovery_loading'),
        ),
      );
    }

    if (_errorMessage != null && _venues.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off, size: 40),
              const SizedBox(height: 12),
              Text(
                'Unable to load venues',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                key: const Key('venue_discovery_retry'),
                onPressed: _loadVenues,
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadVenues,
      child: _venues.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 120),
                Center(child: Text('No venues found')),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: _venues.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final venue = _venues[index];
                return _VenueCard(
                  venue: venue,
                  onTap: widget.onVenueTap == null
                      ? null
                      : () => widget.onVenueTap!(venue),
                );
              },
            ),
    );
  }
}

class _VenueCard extends StatelessWidget {
  const _VenueCard({
    required this.venue,
    this.onTap,
  });

  final VenueSummary venue;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final openColor = venue.isOpen == true
        ? Colors.green.shade700
        : venue.isOpen == false
            ? Colors.red.shade700
            : Colors.grey.shade700;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      venue.name,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  _StatusChip(
                    label: venue.openStatusLabel,
                    color: openColor,
                  ),
                ],
              ),
              if (venue.address?.isNotEmpty == true) ...[
                const SizedBox(height: 4),
                Text(
                  venue.address!,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _MetricBadge(
                    icon: Icons.wifi,
                    label: venue.wifiLabel,
                  ),
                  _MetricBadge(
                    icon: Icons.graphic_eq,
                    label: venue.noiseLabel,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.label,
    required this.color,
  });

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _MetricBadge extends StatelessWidget {
  const _MetricBadge({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Chip(
      avatar: Icon(icon, size: 16),
      label: Text(label),
      visualDensity: VisualDensity.compact,
    );
  }
}
