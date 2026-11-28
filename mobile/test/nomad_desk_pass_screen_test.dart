import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:worksphere_mobile/features/passes/data/nomad_desk_pass.dart';
import 'package:worksphere_mobile/features/passes/data/nomad_desk_pass_cache.dart';
import 'package:worksphere_mobile/features/passes/presentation/nomad_desk_pass_screen.dart';

class _MemoryPassCache implements NomadDeskPassCache {
  final Map<String, NomadDeskPass> passes = {};

  @override
  Future<NomadDeskPass?> read(String bookingId) async => passes[bookingId];

  @override
  Future<void> write(NomadDeskPass pass) async {
    passes[pass.bookingId] = pass;
  }

  @override
  Future<void> remove(String bookingId) async {
    passes.remove(bookingId);
  }
}

void main() {
  testWidgets('renders booking ID, venue, and a scannable QR widget',
      (tester) async {
    final pass = NomadDeskPass.forBooking(
      bookingId: 'booking-123',
      venueName: 'Nomad House',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: NomadDeskPassScreen(
          bookingId: pass.bookingId,
          cache: _MemoryPassCache()..passes[pass.bookingId] = pass,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('booking-123'), findsOneWidget);
    expect(find.text('Nomad House'), findsOneWidget);
    expect(find.byType(QrImageView), findsOneWidget);
  });

  testWidgets('long venue title does not overflow a narrow screen',
      (tester) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final pass = NomadDeskPass.forBooking(
      bookingId: 'booking-narrow',
      venueName:
          'A Very Long Venue Name That Must Remain Within The Narrow Pass Header',
    );
    final cache = _MemoryPassCache()..passes[pass.bookingId] = pass;

    await tester.pumpWidget(
      MaterialApp(
        home: NomadDeskPassScreen(
          bookingId: pass.bookingId,
          cache: cache,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('venue-name')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('uses a fallback when the venue name is empty', (tester) async {
    final pass = NomadDeskPass(
      bookingId: 'booking-empty-venue',
      venueName: ' ',
      qrPayload: 'worksphere://pass/booking-empty-venue',
    );
    final cache = _MemoryPassCache()..passes[pass.bookingId] = pass;

    await tester.pumpWidget(
      MaterialApp(
        home: NomadDeskPassScreen(
          bookingId: pass.bookingId,
          cache: cache,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Venue details unavailable'), findsOneWidget);
  });

  testWidgets('shows cached pass data when the pass loader is offline',
      (tester) async {
    final pass = NomadDeskPass.forBooking(
      bookingId: 'offline-booking',
      venueName: 'Cached Venue',
    );
    final cache = _MemoryPassCache()..passes[pass.bookingId] = pass;

    await tester.pumpWidget(
      MaterialApp(
        home: NomadDeskPassScreen(
          bookingId: pass.bookingId,
          cache: cache,
          loadPass: (_) async => throw Exception('offline'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('offline-booking'), findsOneWidget);
    expect(find.text('Cached Venue'), findsOneWidget);
    expect(find.textContaining('Showing the saved pass'), findsOneWidget);
  });
}
