import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:worksphere_app/features/bookings/data/booking_sync_worker.dart';
import 'package:worksphere_app/features/bookings/presentation/booking_reservation_screen.dart';
import 'package:worksphere_app/features/venue_discovery/data/venue_discovery_repository.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_amenity_filter_controller.dart';
import 'package:worksphere_app/features/venue_discovery/presentation/venue_discovery_screen.dart';

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

    // Preserve path, full query string (including multi-value params), and
    // fragment when forwarding to sign-in.
    final normalizedPath = uri.path.isEmpty ? '/' : uri.path;
    final safePath =
        normalizedPath.startsWith('/') ? normalizedPath : '/$normalizedPath';
    final fullTarget = Uri(
      path: safePath,
      query: uri.hasQuery ? uri.query : null,
      fragment: uri.hasFragment ? uri.fragment : null,
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

const String homeRouteName = 'home';
const String venueDetailsRouteName = 'venueDetails';
const String reservationRouteName = 'reservation';

class VenueId {
  const VenueId._(this.value);

  final String value;

  static VenueId? tryParse(String? value) {
    if (value == null ||
        !RegExp(r'^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$').hasMatch(value)) {
      return null;
    }
    return VenueId._(value);
  }

  factory VenueId.parse(String value) {
    final id = tryParse(value);
    if (id == null) {
      throw FormatException('Invalid venue ID', value);
    }
    return id;
  }
}

void goToVenue(BuildContext context, VenueId venueId) {
  context.goNamed(
    venueDetailsRouteName,
    pathParameters: <String, String>{'id': venueId.value},
  );
}

void goToReservation(BuildContext context, VenueId venueId) {
  context.goNamed(
    reservationRouteName,
    pathParameters: <String, String>{'venueId': venueId.value},
  );
}

class VenueDetailsScreen extends StatelessWidget {
  const VenueDetailsScreen({required this.venueId, super.key});

  final VenueId venueId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Venue details')),
      body: Center(
        child: Text('Venue ID: ${venueId.value}'),
      ),
    );
  }
}

class ReservationScreen extends StatelessWidget {
  const ReservationScreen({
    required this.venueId,
    this.syncWorker,
    super.key,
  });

  final VenueId venueId;
  final BookingSyncWorker? syncWorker;

  @override
  Widget build(BuildContext context) {
    final worker = syncWorker;
    if (worker != null) {
      return BookingReservationScreen(
        venueId: venueId.value,
        syncWorker: worker,
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Reserve a venue')),
      body: Center(
        child: Text('Reservation venue ID: ${venueId.value}'),
      ),
    );
  }
}

class InvalidRouteScreen extends StatelessWidget {
  const InvalidRouteScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Invalid link')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('This link does not contain a valid venue ID.'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context.go('/'),
              child: const Text('Return to WorkSphere'),
            ),
          ],
        ),
      ),
    );
  }
}

class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Page not found')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text("We couldn't find that WorkSphere page."),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () => context.go('/'),
              child: const Text('Go to home'),
            ),
          ],
        ),
      ),
    );
  }
}

class WorkSphereHomeScreen extends StatelessWidget {
  const WorkSphereHomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('WorkSphere')),
      body: const Center(child: Text('Find your next workspace.')),
    );
  }
}

/// Builds the application [GoRouter] preserving query parameters across
/// deep-link redirects.
GoRouter createAppRouter({
  required ValueListenable<bool> isAuthenticated,
  String initialLocation = '/',
  VenuesScreenBuilder? venuesBuilder,
  WidgetBuilder? signInBuilder,
  BookingSyncWorker? bookingSyncWorker,
}) {
  final venueRepository = VenueDiscoveryRepository(
    baseUri: Uri.parse(
      const String.fromEnvironment(
        'WORKSPHERE_API_BASE_URL',
        defaultValue: 'https://worksphere.app',
      ),
    ),
  );

  return GoRouter(
    initialLocation: initialLocation,
    refreshListenable: isAuthenticated,
    errorBuilder: (context, state) => const NotFoundScreen(),
    redirect: (context, state) => buildRedirectLocation(
      state.uri,
      isAuthenticated: isAuthenticated.value,
    ),
    routes: [
      GoRoute(
        path: '/',
        name: homeRouteName,
        builder: (context, state) => const WorkSphereHomeScreen(),
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
          return VenueDiscoveryScreen(
            repository: venueRepository,
            category: params['category'],
            queryParameters: state.uri.queryParametersAll,
            onAmenityFiltersChanged: (selectedAmenities) {
              final router = GoRouter.of(context);
              final currentUri = router.routeInformationProvider.value.uri;
              final queryParameters =
                  VenueAmenityFilterController.queryParametersWithSelection(
                currentUri.queryParametersAll,
                selectedAmenities,
              );
              final nextUri = currentUri.replace(
                queryParameters:
                    queryParameters.isEmpty ? null : queryParameters,
              );
              if (nextUri != currentUri) {
                router.replace(nextUri.toString());
              }
            },
          );
        },
      ),
      GoRoute(
        path: '/venues/:id',
        name: venueDetailsRouteName,
        builder: (context, state) {
          final venueId = VenueId.tryParse(state.pathParameters['id']);
          if (venueId == null) {
            return const InvalidRouteScreen();
          }
          return VenueDetailsScreen(venueId: venueId);
        },
      ),
      GoRoute(
        path: '/reserve/:venueId',
        name: reservationRouteName,
        builder: (context, state) {
          final venueId = VenueId.tryParse(state.pathParameters['venueId']);
          if (venueId == null) {
            return const InvalidRouteScreen();
          }
          return ReservationScreen(
            venueId: venueId,
            syncWorker: bookingSyncWorker,
          );
        },
      ),
    ],
  );
}
