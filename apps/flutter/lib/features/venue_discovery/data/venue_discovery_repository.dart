import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:worksphere_app/features/venue_discovery/domain/venue_summary.dart';

class VenueDiscoveryException implements Exception {
  const VenueDiscoveryException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'VenueDiscoveryException($statusCode): $message';
}

class VenueDiscoveryRepository {
  VenueDiscoveryRepository({
    required this.baseUri,
    http.Client? client,
  }) : _client = client ?? http.Client();

  final Uri baseUri;
  final http.Client _client;

  Future<List<VenueSummary>> fetchVenues({
    String? category,
    int page = 1,
    int limit = 20,
  }) async {
    final query = <String, String>{
      'page': '$page',
      'limit': '$limit',
      if (category != null && category.trim().isNotEmpty)
        'category': category.trim(),
    };

    final uri = baseUri.replace(
      path: '/api/venues',
      queryParameters: query,
    );

    final response = await _client.get(
      uri,
      headers: const {'Accept': 'application/json'},
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw VenueDiscoveryException(
        'Failed to load venues (HTTP ${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map<String, dynamic>) {
      throw const VenueDiscoveryException('Invalid venues response payload');
    }

    final rawList = decoded['venues'];
    if (rawList is! List) {
      return const [];
    }

    return rawList
        .whereType<Map<String, dynamic>>()
        .map(VenueSummary.fromJson)
        .toList(growable: false);
  }
}
