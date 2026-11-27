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
  });
}
