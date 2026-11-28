import 'dart:convert';

import 'package:http/http.dart' as http;

class BookingReservationApiException implements Exception {
  const BookingReservationApiException({
    required this.statusCode,
    required this.isTransient,
  });

  final int statusCode;
  final bool isTransient;

  @override
  String toString() => 'Reservation request failed (HTTP $statusCode).';
}

abstract interface class BookingReservationApi {
  Future<void> createReservation({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  });
}

class HttpBookingReservationApi implements BookingReservationApi {
  HttpBookingReservationApi({
    required this.baseUri,
    required http.Client client,
  }) : _client = client;

  final Uri baseUri;
  final http.Client _client;

  @override
  Future<void> createReservation({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    final response = await _client.post(
      baseUri.replace(path: '/api/bookings'),
      headers: <String, String>{
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: jsonEncode(payload),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final statusCode = response.statusCode;
      final transient = statusCode == 408 ||
          statusCode == 425 ||
          statusCode == 429 ||
          statusCode >= 500;
      throw BookingReservationApiException(
        statusCode: statusCode,
        isTransient: transient,
      );
    }
  }
}
