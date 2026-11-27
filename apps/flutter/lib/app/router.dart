import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Validates that [target] is a safe relative in-app route (starts with `/`
/// and not `//`) to prevent open-redirect vulnerabilities.
String? _sanitizeRelativeRedirect(String? target) {
  if (target == null || target.isEmpty) return null;
  final parsed = Uri.tryParse(target);
  if (parsed == null || parsed.hasScheme || parsed.hasAuthority) {
    return null;
  }
  if (!target.startsWith('/') || target.startsWith('//')) {
    return null;
  }
  return parsed.toString();
}

/// Computes the redirect location for [uri] while preserving `uri.queryParameters`
/// across authentication redirects (e.g., `/venues?category=quiet`).
String? buildRedirectLocation(
  Uri uri, {
  required bool isAuthenticated,
  String signInPath = '/sign-in',
}) {
  final onSignIn = uri.path == signInPath;

  if (!isAuthenticated) {
    if (onSignIn) {
      return null;
    }

    // Preserve both path and query parameters when forwarding to sign-in.
    final fullTarget = Uri(
      path: uri.path.isEmpty ? '/' : uri.path,
      queryParameters: uri.queryParameters.isEmpty ? null : uri.queryParameters,
    ).toString();

    return Uri(
      path: signInPath,
      queryParameters: <String, String>{'redirect': fullTarget},
    ).toString();
  }

  if (onSignIn) {
    final safeRedirect = _sanitizeRelativeRedirect(
      uri.queryParameters['redirect'],
    );
    return safeRedirect ?? '/';
  }

  return null;
}

typedef VenuesScreenBuilder = Widget Function(
  BuildContext context,
  Map<String, String> queryParameters,
);

/// Builds the application [GoRouter] preserving query parameters across
/// deep-link redirects.
GoRouter createAppRouter({
  required ValueListenable<bool> isAuthenticated,
  String initialLocation = '/',
  VenuesScreenBuilder? venuesBuilder,
  WidgetBuilder? signInBuilder,
}) {
  return GoRouter(
    initialLocation: initialLocation,
    refreshListenable: isAuthenticated,
    redirect: (context, state) => buildRedirectLocation(
      state.uri,
      isAuthenticated: isAuthenticated.value,
    ),
    routes: [
      GoRoute(
        path: '/',
        builder: (context, state) => const SizedBox.shrink(),
      ),
      GoRoute(
        path: '/sign-in',
        builder: (context, state) =>
            signInBuilder?.call(context) ?? const SizedBox.shrink(),
      ),
      GoRoute(
        path: '/venues',
        builder: (context, state) {
          final params = state.uri.queryParameters;
          if (venuesBuilder != null) {
            return venuesBuilder(context, params);
          }
          return Text('venues:${params['category'] ?? ''}');
        },
      ),
      GoRoute(
        path: '/venues/:id',
        builder: (context, state) =>
            Text('venue:${state.pathParameters['id'] ?? ''}'),
      ),
      GoRoute(
        path: '/reserve/:venueId',
        builder: (context, state) =>
            Text('reserve:${state.pathParameters['venueId'] ?? ''}'),
      ),
    ],
  );
}
