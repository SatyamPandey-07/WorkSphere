class VenueViewport {
  const VenueViewport({
    required this.south,
    required this.west,
    required this.north,
    required this.east,
  });

  final double south;
  final double west;
  final double north;
  final double east;

  Map<String, String> toQueryParameters() => <String, String>{
        'minLat': '$south',
        'minLng': '$west',
        'maxLat': '$north',
        'maxLng': '$east',
      };
}
