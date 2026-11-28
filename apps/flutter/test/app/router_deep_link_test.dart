import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:worksphere_app/app/router.dart';

void main() {
  group('buildRedirectLocation deep-link query param preservation', () {
    test('preserves query parameters when redirecting unauthenticated user', () {
      final incoming = Uri.parse('/venues?category=quiet');
      final redirect = buildRedirectLocation(
        incoming,
        isAuthenticated: false,
      );

      expect(redirect, isNotNull);
      final redirectUri = Uri.parse(redirect!);
      expect(redirectUri.path, '/sign-in');
      expect(redirectUri.queryParameters['redirect'], '/venues?category=quiet');
    });

    test('restores original path and query parameters after authentication', () {
      final signInUri = Uri(
        path: '/sign-in',
        queryParameters: {'redirect': '/venues?category=quiet'},
      );
      final redirect = buildRedirectLocation(
        signInUri,
        isAuthenticated: true,
      );

      expect(redirect, '/venues?category=quiet');
    });

    test(
        'preserves multi-value query parameters and fragment across auth redirect',
        () {
      final incoming =
          Uri.parse('/venues?category=quiet&amenity=wifi&amenity=power#map');
      final redirect = buildRedirectLocation(
        incoming,
        isAuthenticated: false,
      );

      expect(redirect, isNotNull);
      final redirectUri = Uri.parse(redirect!);
      expect(redirectUri.path, '/sign-in');
      expect(
        redirectUri.queryParameters['redirect'],
        '/venues?category=quiet&amenity=wifi&amenity=power#map',
      );

      final restored = buildRedirectLocation(
        redirectUri,
        isAuthenticated: true,
      );
      expect(restored, '/venues?category=quiet&amenity=wifi&amenity=power#map');
    });

    test('does not strip query parameters when already authenticated', () {
      final incoming = Uri.parse('/venues?category=quiet&wifi=true');
      final redirect = buildRedirectLocation(
        incoming,
        isAuthenticated: true,
      );

      expect(redirect, isNull);
    });

    test('rejects external or protocol-relative redirect targets', () {
      for (final unsafe in ['https://evil.example/venues', '//evil.example']) {
        final signInUri = Uri(
          path: '/sign-in',
          queryParameters: {'redirect': unsafe},
        );
        expect(
          buildRedirectLocation(signInUri, isAuthenticated: true),
          '/',
        );
      }
    });
  });

  group('createAppRouter widget navigation', () {
    testWidgets('preserves /venues?category=quiet across auth state change',
        (tester) async {
      final authState = ValueNotifier<bool>(false);
      addTearDown(authState.dispose);

      Map<String, String>? capturedParams;
      final router = createAppRouter(
        isAuthenticated: authState,
        initialLocation: '/venues?category=quiet',
        signInBuilder: (_) => const Text('Sign In'),
        venuesBuilder: (_, params) {
          capturedParams = params;
          return Text('Category: ${params['category']}');
        },
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      expect(find.text('Sign In'), findsOneWidget);

      authState.value = true;
      await tester.pumpAndSettle();

      expect(find.text('Category: quiet'), findsOneWidget);
      expect(capturedParams, {'category': 'quiet'});
    });

    testWidgets('navigates to venue details with a typed named parameter',
        (tester) async {
      final authState = ValueNotifier<bool>(true);
      addTearDown(authState.dispose);
      final router = createAppRouter(isAuthenticated: authState);
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      router.goNamed(
        venueDetailsRouteName,
        pathParameters: {'id': VenueId.parse('venue-123').value},
      );
      await tester.pumpAndSettle();

      expect(find.text('Venue ID: venue-123'), findsOneWidget);
    });

    testWidgets('navigates to a reservation with a typed named parameter',
        (tester) async {
      final authState = ValueNotifier<bool>(true);
      addTearDown(authState.dispose);
      final router = createAppRouter(isAuthenticated: authState);
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      router.goNamed(
        reservationRouteName,
        pathParameters: {'venueId': VenueId.parse('venue-456').value},
      );
      await tester.pumpAndSettle();

      expect(find.text('Reservation venue ID: venue-456'), findsOneWidget);
    });

    testWidgets('resolves a venue path from an incoming app link',
        (tester) async {
      final authState = ValueNotifier<bool>(true);
      addTearDown(authState.dispose);
      final incomingLink =
          Uri.parse('https://worksphere.app/venues/linked-venue');
      final router = createAppRouter(
        isAuthenticated: authState,
        initialLocation: incomingLink.path,
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      expect(find.text('Venue ID: linked-venue'), findsOneWidget);
    });

    testWidgets('shows a 404 screen and can return home for unknown routes',
        (tester) async {
      final authState = ValueNotifier<bool>(true);
      addTearDown(authState.dispose);
      final router = createAppRouter(
        isAuthenticated: authState,
        initialLocation: '/not-a-route',
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();

      expect(find.text('Page not found'), findsOneWidget);
      await tester.tap(find.text('Go to home'));
      await tester.pumpAndSettle();
      expect(find.text('Find your next workspace.'), findsOneWidget);
    });

    testWidgets('handles missing and invalid venue IDs gracefully',
        (tester) async {
      final authState = ValueNotifier<bool>(true);
      addTearDown(authState.dispose);
      final router = createAppRouter(
        isAuthenticated: authState,
        initialLocation: '/venues/%20',
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      expect(find.text('Invalid link'), findsOneWidget);

      router.go('/venues/');
      await tester.pumpAndSettle();
      expect(find.text('Page not found'), findsOneWidget);
    });
  });
}
