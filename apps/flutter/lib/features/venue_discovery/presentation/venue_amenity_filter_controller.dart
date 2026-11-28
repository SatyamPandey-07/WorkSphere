import 'package:flutter/foundation.dart';
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';

enum VenueAmenity {
  quietZone('quiet-zone', 'Quiet Zone'),
  gigabitWifi('gigabit-wifi', 'Gigabit WiFi'),
  powerOutlets('power-outlets', 'Power Outlets');

  const VenueAmenity(this.queryValue, this.label);

  final String queryValue;
  final String label;
}

class VenueAmenityFilterController extends ChangeNotifier {
  VenueAmenityFilterController({
    Map<String, List<String>> queryParameters = const {},
  }) : _selectedAmenities = _parseAmenities(queryParameters);

  static const String queryParameter = 'amenities';

  Set<VenueAmenity> _selectedAmenities;

  Set<VenueAmenity> get selectedAmenities =>
      Set<VenueAmenity>.unmodifiable(_selectedAmenities);

  bool isSelected(VenueAmenity amenity) =>
      _selectedAmenities.contains(amenity);

  void toggle(VenueAmenity amenity) {
    final next = Set<VenueAmenity>.of(_selectedAmenities);
    if (!next.add(amenity)) {
      next.remove(amenity);
    }
    _setSelectedAmenities(next);
  }

  void clear() {
    _setSelectedAmenities({});
  }

  void updateFromQueryParameters(Map<String, List<String>> queryParameters) {
    _setSelectedAmenities(_parseAmenities(queryParameters));
  }

  List<VenueSummary> filterVenues(Iterable<VenueSummary> venues) {
    return venues
        .where((venue) => _selectedAmenities.every(
              (amenity) => _hasAmenity(venue, amenity),
            ))
        .toList(growable: false);
  }

  Map<String, dynamic> queryParametersForSelection(
    Map<String, List<String>> existing,
  ) =>
      queryParametersWithSelection(
        existing,
        VenueAmenity.values
            .where(_selectedAmenities.contains)
            .map((amenity) => amenity.queryValue),
      );

  static Map<String, dynamic> queryParametersWithSelection(
    Map<String, List<String>> existing,
    Iterable<String> selectedValues,
  ) {
    final selected = _parseAmenities(
      <String, List<String>>{queryParameter: selectedValues.toList()},
    );
    final result = <String, dynamic>{
      for (final entry in existing.entries)
        if (entry.key != queryParameter) entry.key: entry.value,
    };
    if (selected.isNotEmpty) {
      result[queryParameter] = VenueAmenity.values
          .where(selected.contains)
          .map((amenity) => amenity.queryValue)
          .toList(growable: false);
    }
    return result;
  }

  void _setSelectedAmenities(Set<VenueAmenity> next) {
    if (setEquals(_selectedAmenities, next)) {
      return;
    }
    _selectedAmenities = next;
    notifyListeners();
  }

  static Set<VenueAmenity> _parseAmenities(
    Map<String, List<String>> queryParameters,
  ) {
    final values = queryParameters[queryParameter] ?? const <String>[];
    final selected = <VenueAmenity>{};
    for (final rawValue in values) {
      for (final value in rawValue.split(',')) {
        final normalized = value.trim().toLowerCase().replaceAll('_', '-');
        for (final amenity in VenueAmenity.values) {
          if (normalized == amenity.queryValue) {
            selected.add(amenity);
          }
        }
      }
    }
    return selected;
  }

  static bool _hasAmenity(VenueSummary venue, VenueAmenity amenity) {
    switch (amenity) {
      case VenueAmenity.quietZone:
        return venue.hasQuietZone ??
            ((venue.avgNoiseLevel != null && venue.avgNoiseLevel! < 50) ||
                venue.hasAmenityLabel('quiet-zone'));
      case VenueAmenity.gigabitWifi:
        return venue.hasGigabitWifi ??
            ((venue.avgWifiSpeed != null && venue.avgWifiSpeed! >= 1000) ||
                venue.hasAmenityLabel('gigabit-wifi'));
      case VenueAmenity.powerOutlets:
        return venue.hasPowerOutlets ??
            venue.hasAmenityLabel('power-outlets');
    }
  }
}
