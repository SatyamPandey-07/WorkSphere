import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:path/path.dart' as path;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:worksphere_app/features/bookings/data/booking_draft_store.dart';
import 'package:worksphere_app/features/bookings/data/booking_reservation_api.dart';
import 'package:worksphere_app/features/bookings/data/booking_sync_worker.dart';
import 'package:worksphere_app/features/bookings/domain/booking_draft.dart';

void main() {
  late Directory temporaryDirectory;
  final stores = <SqliteBookingDraftStore>[];
  final workers = <BookingSyncWorker>[];
  final connectivityStreams = <StreamController<bool>>[];

  setUpAll(() {
    sqfliteFfiInit();
  });

  setUp(() async {
    temporaryDirectory =
        await Directory.systemTemp.createTemp('worksphere-booking-queue-');
    stores.clear();
    workers.clear();
    connectivityStreams.clear();
  });

  tearDown(() async {
    for (final worker in workers) {
      worker.dispose();
    }
    for (final stream in connectivityStreams) {
      await stream.close();
    }
    for (final store in stores) {
      await store.close();
    }
    await temporaryDirectory.delete(recursive: true);
  });

  Future<SqliteBookingDraftStore> openStore() async {
    final store = await SqliteBookingDraftStore.open(
      databasePath: path.join(temporaryDirectory.path, 'booking-drafts.db'),
      databaseFactory: databaseFactoryFfi,
    );
    stores.add(store);
    return store;
  }

  StreamController<bool> makeConnectivity() {
    final stream = StreamController<bool>.broadcast(sync: true);
    connectivityStreams.add(stream);
    return stream;
  }

  BookingSyncWorker makeWorker({
    required SqliteBookingDraftStore store,
    required FakeReservationApi api,
    required Stream<bool> connectivity,
    int maxAttempts = 3,
    Duration retryBaseDelay = const Duration(milliseconds: 5),
  }) {
    final worker = BookingSyncWorker(
      store: store,
      api: api,
      connectivityChanges: connectivity,
      maxAttempts: maxAttempts,
      retryBaseDelay: retryBaseDelay,
      workerId: 'test-worker-${workers.length}',
    );
    workers.add(worker);
    return worker;
  }

  Future<BookingDraft> waitForStatus(
    SqliteBookingDraftStore store,
    String key,
    BookingDraftStatus status,
  ) async {
    for (var attempt = 0; attempt < 100; attempt++) {
      final drafts = await store.listDrafts();
      for (final draft in drafts) {
        if (draft.idempotencyKey == key && draft.status == status) {
          return draft;
        }
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    fail('Draft $key did not reach $status.');
  }

  test('persists offline reservation drafts in SQLite', () async {
    final store = await openStore();
    final draft = await store.enqueue(
      const {'venueId': 'venue-1', 'guests': 2},
      idempotencyKey: 'booking-key-offline',
    );

    expect(draft.status, BookingDraftStatus.pending);
    final saved = await store.listDrafts();
    expect(saved, hasLength(1));
    expect(saved.single.idempotencyKey, 'booking-key-offline');
    expect(saved.single.payload['venueId'], 'venue-1');
  });

  test('replays queued reservations when connectivity returns', () async {
    final store = await openStore();
    final connectivity = makeConnectivity();
    final api = FakeReservationApi();
    final worker = makeWorker(
      store: store,
      api: api,
      connectivity: connectivity.stream,
    );
    final draft = await worker.enqueueReservation(
      const {'venueId': 'venue-2', 'guests': 1},
    );

    expect((await store.listDrafts()).single.status, BookingDraftStatus.pending);
    connectivity.add(true);
    final completed = await waitForStatus(
      store,
      draft.idempotencyKey,
      BookingDraftStatus.completed,
    );

    expect(api.keys, [draft.idempotencyKey]);
    expect(completed.status, BookingDraftStatus.completed);
  });

  test('recovers drafts after reopening the persistent store', () async {
    final firstStore = await openStore();
    final draft = await firstStore.enqueue(
      const {'venueId': 'venue-3'},
      idempotencyKey: 'booking-key-restart',
    );
    await firstStore.close();
    stores.remove(firstStore);

    final reopenedStore = await openStore();
    final recovered = await reopenedStore.listDrafts();

    expect(recovered, hasLength(1));
    expect(recovered.single.idempotencyKey, draft.idempotencyKey);
    expect(recovered.single.payload['venueId'], 'venue-3');
    expect(recovered.single.status, BookingDraftStatus.pending);
  });

  test('preserves the idempotency key when retrying after a lost response',
      () async {
    final firstStore = await openStore();
    final original = await firstStore.enqueue(
      const {'venueId': 'venue-4'},
      idempotencyKey: 'booking-key-retry',
    );
    await firstStore.close();
    stores.remove(firstStore);

    final reopenedStore = await openStore();
    final connectivity = makeConnectivity();
    final api = FakeReservationApi(
      outcomes: [const SocketException('response lost'), null],
      simulateIdempotentRemoteCreation: true,
    );
    makeWorker(
      store: reopenedStore,
      api: api,
      connectivity: connectivity.stream,
      retryBaseDelay: const Duration(milliseconds: 1),
    );
    connectivity.add(true);

    final completed = await waitForStatus(
      reopenedStore,
      original.idempotencyKey,
      BookingDraftStatus.completed,
    );

    expect(api.keys, ['booking-key-retry', 'booking-key-retry']);
    expect(api.remoteCreationCount, 1);
    expect(completed.idempotencyKey, original.idempotencyKey);
  });

  test('retries transient API errors and completes on a later attempt',
      () async {
    final store = await openStore();
    final connectivity = makeConnectivity();
    final api = FakeReservationApi(
      outcomes: [
        const BookingReservationApiException(
          statusCode: 503,
          isTransient: true,
        ),
        null,
      ],
    );
    final worker = makeWorker(
      store: store,
      api: api,
      connectivity: connectivity.stream,
      retryBaseDelay: const Duration(milliseconds: 1),
    );
    final draft = await worker.enqueueReservation(
      const {'venueId': 'venue-5'},
    );
    connectivity.add(true);

    final completed = await waitForStatus(
      store,
      draft.idempotencyKey,
      BookingDraftStatus.completed,
    );

    expect(api.keys, [draft.idempotencyKey, draft.idempotencyKey]);
    expect(completed.attemptCount, 2);
  });

  test('concurrent workers do not process the same draft twice', () async {
    final store = await openStore();
    final draft = await store.enqueue(
      const {'venueId': 'venue-6'},
      idempotencyKey: 'booking-key-concurrent',
    );
    final connectivityA = makeConnectivity();
    final connectivityB = makeConnectivity();
    final apiA = FakeReservationApi(blockRequest: true);
    final apiB = FakeReservationApi();
    makeWorker(
      store: store,
      api: apiA,
      connectivity: connectivityA.stream,
    );
    final workerB = makeWorker(
      store: store,
      api: apiB,
      connectivity: connectivityB.stream,
    );
    connectivityA.add(true);
    await apiA.requestStarted.future;
    connectivityB.add(true);
    await workerB.syncNow();

    expect(apiA.keys, [draft.idempotencyKey]);
    expect(apiB.keys, isEmpty);

    apiA.finishRequest.complete();
    await waitForStatus(store, draft.idempotencyKey, BookingDraftStatus.completed);
  });

  test('marks permanent API errors failed without retrying', () async {
    final store = await openStore();
    final connectivity = makeConnectivity();
    final api = FakeReservationApi(
      outcomes: [
        const BookingReservationApiException(
          statusCode: 400,
          isTransient: false,
        ),
      ],
    );
    final worker = makeWorker(
      store: store,
      api: api,
      connectivity: connectivity.stream,
    );
    final draft = await worker.enqueueReservation(
      const {'venueId': 'venue-7'},
    );
    connectivity.add(true);

    final failed = await waitForStatus(
      store,
      draft.idempotencyKey,
      BookingDraftStatus.failed,
    );

    expect(api.keys, [draft.idempotencyKey]);
    expect(failed.lastError, contains('HTTP 400'));
  });

  test('sends the persisted idempotency key in the API request header',
      () async {
    final mockClient = MockClient((request) async {
      expect(request.headers['Idempotency-Key'], 'persisted-key');
      return http.Response('{}', 201);
    });
    final api = HttpBookingReservationApi(
      baseUri: Uri.parse('https://worksphere.app'),
      client: mockClient,
    );

    await api.createReservation(
      payload: const {'venueId': 'venue-8'},
      idempotencyKey: 'persisted-key',
    );
  });
}

class FakeReservationApi implements BookingReservationApi {
  FakeReservationApi({
    List<Object?> outcomes = const [],
    this.simulateIdempotentRemoteCreation = false,
    this.blockRequest = false,
  }) : outcomes = List<Object?>.of(outcomes);

  final List<Object?> outcomes;
  final bool simulateIdempotentRemoteCreation;
  final bool blockRequest;
  final List<String> keys = [];
  final Set<String> _processedKeys = {};
  final Completer<void> requestStarted = Completer<void>();
  final Completer<void> finishRequest = Completer<void>();
  int remoteCreationCount = 0;

  @override
  Future<void> createReservation({
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    keys.add(idempotencyKey);
    if (simulateIdempotentRemoteCreation &&
        _processedKeys.add(idempotencyKey)) {
      remoteCreationCount++;
    }
    if (blockRequest) {
      if (!requestStarted.isCompleted) {
        requestStarted.complete();
      }
      await finishRequest.future;
    }
    if (outcomes.isNotEmpty) {
      final outcome = outcomes.removeAt(0);
      if (outcome != null) {
        throw outcome;
      }
    }
  }
}
