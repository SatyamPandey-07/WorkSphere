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
  });

  final String id;
  final String name;
  final String? address;
  final String? category;
  final double? avgWifiSpeed;
  final double? avgNoiseLevel;
  final bool? isOpen;
  final double? avgRating;

  factory VenueSummary.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic value) {
      if (value is num && value.isFinite) return value.toDouble();
      if (value is String) return double.tryParse(value);
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
