import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;
import 'package:worksphere_app/features/bookings/data/booking_connectivity.dart';
import 'package:worksphere_app/features/bookings/data/booking_draft_store.dart';
import 'package:worksphere_app/features/bookings/data/booking_reservation_api.dart';
import 'package:worksphere_app/features/bookings/data/booking_sync_worker.dart';

class BookingSyncRuntime {
  BookingSyncRuntime._({
    required this.store,
    required this.httpClient,
    required this.worker,
  });

  final SqliteBookingDraftStore store;
  final http.Client httpClient;
  final BookingSyncWorker worker;
  bool _disposed = false;

  static Future<BookingSyncRuntime> open({
    required Uri baseUri,
    Connectivity? connectivity,
  }) async {
    final store = await SqliteBookingDraftStore.open();
    final httpClient = http.Client();
    final connectivityClient = connectivity ?? Connectivity();
    final worker = BookingSyncWorker(
      store: store,
      api: HttpBookingReservationApi(
        baseUri: baseUri,
        client: httpClient,
      ),
      connectivityChanges:
          bookingConnectivityChanges(connectivityClient),
    );
    return BookingSyncRuntime._(
      store: store,
      httpClient: httpClient,
      worker: worker,
    );
  }

  Future<void> dispose() async {
    if (_disposed) {
      return;
    }
    _disposed = true;
    worker.dispose();
    httpClient.close();
    await store.close();
  }
}
