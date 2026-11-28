import 'dart:convert';

import 'package:http/http.dart' as http;

class ApiResponse<T> {
  const ApiResponse({
    required this.statusCode,
    required this.headers,
    required this.body,
    required this.data,
  });

  final int statusCode;
  final Map<String, String> headers;
  final String body;
  final T data;

  bool get isSuccess => statusCode >= 200 && statusCode < 300;
}

class ApiException implements Exception {
  const ApiException({
    required this.message,
    required this.statusCode,
    this.responseBody,
  });

  final String message;
  final int statusCode;
  final String? responseBody;

  @override
  String toString() => 'ApiException($statusCode): $message';
}

class ApiClient {
  ApiClient({
    http.Client? client,
    String? baseUrl,
    String? appVersion,
  })  : _client = client ?? http.Client(),
        baseUrl = baseUrl ??
            const String.fromEnvironment(
              'WORKSPHERE_API_BASE_URL',
              defaultValue: 'https://worksphere.app',
            ),
        appVersion = appVersion ??
            const String.fromEnvironment(
              'WORKSPHERE_APP_VERSION',
              defaultValue: '0.1.0',
            );

  final http.Client _client;
  final String baseUrl;
  final String appVersion;

  static const String platformHeader = 'X-WorkSphere-Platform';
  static const String appVersionHeader = 'X-WorkSphere-App-Version';

  Uri resolve(String path, [Map<String, dynamic>? queryParameters]) {
    final base = Uri.parse(baseUrl);
    final normalizedPath =
        path.startsWith('/') ? path : '/${path.replaceAll(RegExp(r'^/+'), '')}';
    final basePath = base.path.endsWith('/')
        ? base.path.substring(0, base.path.length - 1)
        : base.path;
    final mergedPath = normalizedPath == '/'
        ? '${basePath.isEmpty ? '' : basePath}/'
        : '$basePath$normalizedPath';
    final mergedQuery = <String, String>{
      ...base.queryParameters,
      if (queryParameters != null)
        ...queryParameters.map(
          (key, value) => MapEntry(key, value?.toString() ?? ''),
        ),
    };

    return base.replace(
      path: mergedPath,
      queryParameters: mergedQuery.isEmpty ? null : mergedQuery,
    );
  }

  Map<String, String> _headers(Map<String, String>? headers) {
    return <String, String>{
      'Accept': 'application/json',
      if (headers != null) ...headers,
      'Content-Type': 'application/json',
      platformHeader: 'flutter',
      appVersionHeader: appVersion,
    };
  }

  Future<ApiResponse<T>> get<T>(
    String path, {
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? decoder,
  }) {
    return _send<T>(
      method: 'GET',
      uri: resolve(path, queryParameters),
      headers: headers,
      decoder: decoder,
    );
  }

  Future<ApiResponse<T>> post<T>(
    String path, {
    Object? body,
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? decoder,
  }) {
    return _send<T>(
      method: 'POST',
      uri: resolve(path, queryParameters),
      headers: headers,
      body: body,
      decoder: decoder,
    );
  }

  Future<ApiResponse<T>> put<T>(
    String path, {
    Object? body,
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? decoder,
  }) {
    return _send<T>(
      method: 'PUT',
      uri: resolve(path, queryParameters),
      headers: headers,
      body: body,
      decoder: decoder,
    );
  }

  Future<ApiResponse<T>> patch<T>(
    String path, {
    Object? body,
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? decoder,
  }) {
    return _send<T>(
      method: 'PATCH',
      uri: resolve(path, queryParameters),
      headers: headers,
      body: body,
      decoder: decoder,
    );
  }

  Future<ApiResponse<T>> delete<T>(
    String path, {
    Object? body,
    Map<String, String>? headers,
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? decoder,
  }) {
    return _send<T>(
      method: 'DELETE',
      uri: resolve(path, queryParameters),
      headers: headers,
      body: body,
      decoder: decoder,
    );
  }

  Future<ApiResponse<T>> _send<T>({
    required String method,
    required Uri uri,
    Map<String, String>? headers,
    Object? body,
    T Function(dynamic json)? decoder,
  }) async {
    final encodedBody = body == null
        ? null
        : body is String
            ? body
            : jsonEncode(body);
    late http.Response response;

    switch (method) {
      case 'GET':
        response = await _client.get(uri, headers: _headers(headers));
        break;
      case 'POST':
        response =
            await _client.post(uri, headers: _headers(headers), body: encodedBody);
        break;
      case 'PUT':
        response =
            await _client.put(uri, headers: _headers(headers), body: encodedBody);
        break;
      case 'PATCH':
        response =
            await _client.patch(uri, headers: _headers(headers), body: encodedBody);
        break;
      case 'DELETE':
        response =
            await _client.delete(uri, headers: _headers(headers), body: encodedBody);
        break;
      default:
        throw UnsupportedError('Unsupported HTTP method: $method');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ApiException(
        message: _errorMessage(response.body),
        statusCode: response.statusCode,
        responseBody: response.body,
      );
    }

    dynamic json;
    if (response.body.isNotEmpty) {
      try {
        json = jsonDecode(response.body);
      } on FormatException {
        json = response.body;
      }
    }

    final T data = decoder == null
        ? (json as T?)
        : decoder(json);

    return ApiResponse<T>(
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body,
      data: data,
    );
  }

  String _errorMessage(String body) {
    if (body.isEmpty) {
      return 'Request failed';
    }
    try {
      final decoded = jsonDecode(body);
      if (decoded is Map<String, dynamic>) {
        final message = decoded['message'] ?? decoded['error'];
        if (message != null) {
          return message.toString();
        }
      }
    } catch (_) {}
    return body;
  }

  void close() => _client.close();
}
