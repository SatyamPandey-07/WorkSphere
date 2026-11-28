import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worksphere_app/core/api/api_client.dart';

void main() {
  group('ApiClient', () {
    test('attaches WorkSphere headers and configured app version', () async {
      final client = MockClient((request) async {
        expect(request.headers[ApiClient.platformHeader], 'flutter');
        expect(request.headers[ApiClient.appVersionHeader], '2.4.1');
        return http.Response(jsonEncode({'ok': true}), 200);
      });
      final api = ApiClient(
        client: client,
        baseUrl: 'https://api.example.com',
        appVersion: '2.4.1',
      );

      await api.get<Map<String, dynamic>>(
        '/health',
        decoder: (json) => json as Map<String, dynamic>,
      );
    });

    test('uses configured base URL and resolves query parameters', () async {
      final client = MockClient((request) async {
        expect(request.url, Uri.parse(
          'https://api.example.com/v1/bookings?page=2&status=open',
        ));
        return http.Response(jsonEncode([]), 200);
      });
      final api = ApiClient(
        client: client,
        baseUrl: 'https://api.example.com/v1',
        appVersion: '1.0.0',
      );

      await api.get<List<dynamic>>(
        '/bookings',
        queryParameters: {'page': 2, 'status': 'open'},
        decoder: (json) => json as List<dynamic>,
      );
    });

    test('attaches headers to GET, POST, PUT, PATCH, and DELETE', () async {
      final methods = <String>[];
      final client = MockClient((request) async {
        methods.add(request.method);
        expect(request.headers[ApiClient.platformHeader], 'flutter');
        expect(request.headers[ApiClient.appVersionHeader], '3.0.0');
        return http.Response('{}', 200);
      });
      final api = ApiClient(
        client: client,
        baseUrl: 'https://api.example.com',
        appVersion: '3.0.0',
      );

      await api.get<Map<String, dynamic>>('/get');
      await api.post<Map<String, dynamic>>('/post', body: {'value': 1});
      await api.put<Map<String, dynamic>>('/put', body: {'value': 2});
      await api.patch<Map<String, dynamic>>('/patch', body: {'value': 3});
      await api.delete<Map<String, dynamic>>('/delete');

      expect(methods, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    });

    test('returns typed decoded response data', () async {
      final client = MockClient((request) async {
        return http.Response(
          jsonEncode({'id': 'booking-1', 'title': 'Focus session'}),
          200,
        );
      });
      final api = ApiClient(
        client: client,
        baseUrl: 'https://api.example.com',
        appVersion: '1.2.3',
      );

      final response = await api.get<_Booking>(
        '/bookings/booking-1',
        decoder: (json) => _Booking.fromJson(json as Map<String, dynamic>),
      );

      expect(response.statusCode, 200);
      expect(response.isSuccess, isTrue);
      expect(response.data.id, 'booking-1');
      expect(response.data.title, 'Focus session');
    });

    test('encodes request JSON and throws typed API errors', () async {
      String? recordedBody;
      final successClient = MockClient((request) async {
        recordedBody = request.body;
        return http.Response(jsonEncode({'saved': true}), 201);
      });
      final api = ApiClient(
        client: successClient,
        baseUrl: 'https://api.example.com',
        appVersion: '1.0.0',
      );

      final response = await api.post<Map<String, dynamic>>(
        '/bookings',
        body: {'title': 'Deep work'},
        decoder: (json) => json as Map<String, dynamic>,
      );

      expect(recordedBody, jsonEncode({'title': 'Deep work'}));
      expect(response.statusCode, 201);
      expect(response.data['saved'], isTrue);

      final errorApi = ApiClient(
        client: MockClient((request) async {
          return http.Response(jsonEncode({'message': 'Booking not found'}), 404);
        }),
        baseUrl: 'https://api.example.com',
        appVersion: '1.0.0',
      );

      await expectLater(
        errorApi.get<Map<String, dynamic>>('/bookings/missing'),
        throwsA(
          isA<ApiException>()
              .having((error) => error.statusCode, 'statusCode', 404)
              .having(
                (error) => error.message,
                'message',
                'Booking not found',
              ),
        ),
      );
    });
  });
}

class _Booking {
  const _Booking({required this.id, required this.title});

  final String id;
  final String title;

  factory _Booking.fromJson(Map<String, dynamic> json) {
    return _Booking(
      id: json['id'] as String,
      title: json['title'] as String,
    );
  }
}
