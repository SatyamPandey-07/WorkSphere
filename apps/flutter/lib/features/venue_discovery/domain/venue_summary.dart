/// Lightweight venue model parsed from `GET /api/venues`.
class VenueSummary {
  const VenueSummary({
    required this.id,
    required this.name,
    this.address,
    this.category,
    this.avgWifiSpeed,
    this.avgNoiseLevel,
    this.isOpen,
    this.avgRating,
    this.latitude,
    this.longitude,
    this.hasQuietZone,
    this.hasGigabitWifi,
    this.hasPowerOutlets,
    this.amenities = const [],
  });

  final String id;
  final String name;
  final String? address;
  final String? category;
  final double? avgWifiSpeed;
  final double? avgNoiseLevel;
  final bool? isOpen;
  final double? avgRating;
  final double? latitude;
  final double? longitude;
  final bool? hasQuietZone;
  final bool? hasGigabitWifi;
  final bool? hasPowerOutlets;
  final List<String> amenities;

  bool hasAmenityLabel(String amenity) {
    String normalize(String value) =>
        value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '');

    return amenities.any((value) => normalize(value) == normalize(amenity));
  }

  factory VenueSummary.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic value) {
      if (value is num && value.isFinite) return value.toDouble();
      if (value is String) return double.tryParse(value);
      return null;
    }

    final location = json['location'];
    final locationMap =
        location is Map<String, dynamic> ? location : const <String, dynamic>{};
    final coordinates = json['coordinates'] ?? locationMap['coordinates'];
    final coordinateList = coordinates is List ? coordinates : const [];
    final rawAmenities = json['amenities'];
    final amenities = <String>[];
    if (rawAmenities is List) {
      amenities.addAll(rawAmenities.map((value) => value.toString()));
    } else if (rawAmenities is Map) {
      for (final entry in rawAmenities.entries) {
        if (entry.value == true) {
          amenities.add(entry.key.toString());
        }
      }
    }
    bool? toBool(dynamic value) {
      if (value is bool) return value;
      if (value is num) return value != 0;
      if (value is String) {
        switch (value.trim().toLowerCase()) {
          case 'true':
          case '1':
          case 'yes':
            return true;
          case 'false':
          case '0':
          case 'no':
            return false;
        }
      }
      return null;
    }

    return VenueSummary(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? 'Unnamed Venue').toString(),
      address: json['address']?.toString(),
      category: json['category']?.toString(),
      avgWifiSpeed:
          toDouble(json['avgWifiSpeed']) ?? toDouble(json['wifiSpeed']),
      avgNoiseLevel:
          toDouble(json['avgNoiseLevel']) ?? toDouble(json['noiseLevel']),
      isOpen: json['isOpen'] is bool ? json['isOpen'] as bool : null,
      avgRating: toDouble(json['avgRating']),
      latitude: toDouble(json['latitude']) ??
          toDouble(json['lat']) ??
          toDouble(locationMap['latitude']) ??
          toDouble(locationMap['lat']) ??
          (coordinateList.length > 1 ? toDouble(coordinateList[1]) : null),
      longitude: toDouble(json['longitude']) ??
          toDouble(json['lng']) ??
          toDouble(json['lon']) ??
          toDouble(locationMap['longitude']) ??
          toDouble(locationMap['lng']) ??
          toDouble(locationMap['lon']) ??
          (coordinateList.isNotEmpty ? toDouble(coordinateList[0]) : null),
      hasQuietZone: toBool(json['hasQuietZone'] ?? json['quietZone']),
      hasGigabitWifi:
          toBool(json['hasGigabitWifi'] ?? json['gigabitWifi']),
      hasPowerOutlets:
          toBool(json['hasPowerOutlets'] ?? json['powerOutlets']),
      amenities: List<String>.unmodifiable(amenities),
    );
  }

  /// Maps decibel level to WorkSphere noise categories (<50, 50-69, >=70 dB).
  String get noiseLabel {
    final db = avgNoiseLevel;
    if (db == null) return 'Noise N/A';
    final rounded = db.round();
    if (db < 50) return '$rounded dB · Quiet';
    if (db < 70) return '$rounded dB · Moderate';
    return '$rounded dB · Loud';
  }

  String get wifiLabel {
    final speed = avgWifiSpeed;
    if (speed == null) return 'WiFi N/A';
    return '${speed.round()} Mbps';
  }

  String get openStatusLabel {
    if (isOpen == null) return 'Hours N/A';
    return isOpen! ? 'Open' : 'Closed';
  }
}
