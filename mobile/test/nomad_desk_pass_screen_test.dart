import 'dart:typed_data';

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

  testWidgets('shows Share Pass and shares the booking summary and QR image',
      (tester) async {
    final pass = NomadDeskPass.forBooking(
      bookingId: 'booking-share-123',
      venueName: 'Nomad House',
      venueAddress: '12 Market Street',
    );
    final cache = _MemoryPassCache()..passes[pass.bookingId] = pass;
    var shareCalls = 0;
    String? sharedText;
    String? sharedBookingId;
    String? sharedQrPayload;
    Uint8List? sharedQrImage;

    await tester.pumpWidget(
      MaterialApp(
        home: NomadDeskPassScreen(
          bookingId: pass.bookingId,
          cache: cache,
          sharePass: ({
            required bookingId,
            required text,
            required qrPayload,
            required qrImageBytes,
          }) async {
            shareCalls++;
            sharedBookingId = bookingId;
            sharedText = text;
            sharedQrPayload = qrPayload;
            sharedQrImage = qrImageBytes;
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Share Pass'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('pass-share')));
    await tester.pumpAndSettle();

    expect(shareCalls, 1);
    expect(sharedBookingId, 'booking-share-123');
    expect(sharedText, contains('Booking ID: booking-share-123'));
    expect(sharedText, contains('Venue: Nomad House'));
    expect(sharedText, contains('Venue address: 12 Market Street'));
    expect(sharedText, isNot(contains('null')));
    expect(sharedQrPayload, pass.qrPayload);
    expect(sharedQrImage, isNotNull);
    expect(sharedQrImage, isNotEmpty);
  });

  testWidgets('omits null and empty venue addresses from shared content',
      (tester) async {
    for (final address in <String?>[null, '', '   ']) {
      final pass = NomadDeskPass(
        bookingId: 'booking-no-address',
        venueName: 'Nomad House',
        venueAddress: address,
        qrPayload: 'worksphere://pass/booking-no-address',
      );
      final cache = _MemoryPassCache()..passes[pass.bookingId] = pass;
      String? sharedText;

      await tester.pumpWidget(
        MaterialApp(
          home: NomadDeskPassScreen(
            bookingId: pass.bookingId,
            cache: cache,
            sharePass: ({
              required bookingId,
              required text,
              required qrPayload,
              required qrImageBytes,
            }) async {
              sharedText = text;
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('pass-share')));
      await tester.pumpAndSettle();

      expect(sharedText, contains('Booking ID: booking-no-address'));
      expect(sharedText, contains('Venue: Nomad House'));
      expect(sharedText, isNot(contains('Venue address:')));
      expect(sharedText, isNot(contains('null')));
    }
  });

  testWidgets('shows feedback when sharing fails', (tester) async {
    final pass = NomadDeskPass.forBooking(
      bookingId: 'booking-share-failure',
      venueName: 'Nomad House',
    );
    final cache = _MemoryPassCache()..passes[pass.bookingId] = pass;

    await tester.pumpWidget(
      MaterialApp(
        home: NomadDeskPassScreen(
          bookingId: pass.bookingId,
          cache: cache,
          sharePass: ({
            required bookingId,
            required text,
            required qrPayload,
            required qrImageBytes,
          }) async {
            throw Exception('sharing unavailable');
          },
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('pass-share')));
    await tester.pumpAndSettle();

    expect(
      find.text('Unable to share the pass. Please try again.'),
      findsOneWidget,
    );
  });
}
