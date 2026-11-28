import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:worksphere_app/features/bookings/data/booking_draft_store.dart';
import 'package:worksphere_app/features/bookings/data/booking_reservation_api.dart';
import 'package:worksphere_app/features/bookings/domain/booking_draft.dart';

class BookingSyncWorker extends ChangeNotifier {
  BookingSyncWorker({
    required BookingDraftStore store,
    required BookingReservationApi api,
    required Stream<bool> connectivityChanges,
    this.maxAttempts = 5,
    this.leaseDuration = const Duration(minutes: 2),
    this.retryBaseDelay = const Duration(seconds: 1),
    String? workerId,
  })  : _store = store,
        _api = api,
        _workerId = workerId ?? _newWorkerId() {
    _connectivitySubscription = connectivityChanges.listen(
      (online) {
        if (_disposed) {
          return;
        }
        _isOnline = online;
        _connectivityError = null;
        notifyListeners();
        unawaited(_handleConnectivityChange(online));
      },
      onError: (Object error, StackTrace stackTrace) {
        if (!_disposed) {
          _connectivityError = 'Connectivity status is unavailable.';
          notifyListeners();
        }
      },
    );
  }

  final BookingDraftStore _store;
  final BookingReservationApi _api;
  final String _workerId;
  final int maxAttempts;
  final Duration leaseDuration;
  final Duration retryBaseDelay;

  StreamSubscription<bool>? _connectivitySubscription;
  Timer? _retryTimer;
  Future<void>? _activeSync;
  List<BookingDraft> _drafts = const [];
  bool _isOnline = false;
  bool _isSyncing = false;
  bool _disposed = false;
  String? _connectivityError;

  List<BookingDraft> get drafts => List.unmodifiable(_drafts);
  bool get isOnline => _isOnline;
  bool get isSyncing => _isSyncing;
  String? get connectivityError => _connectivityError;

  Future<BookingDraft> enqueueReservation(Map<String, dynamic> payload) async {
    if (_disposed) {
      throw StateError('Cannot enqueue a reservation after disposal.');
    }
    final draft = await _store.enqueue(payload);
    await refreshDrafts();
    if (_isOnline) {
      _runInBackground();
    }
    return draft;
  }

  Future<void> refreshDrafts() async {
    if (_disposed) {
      return;
    }
    _drafts = await _store.listDrafts();
    _notifyIfAlive();
  }

  Future<void> syncNow() {
    if (_disposed || !_isOnline) {
      return Future<void>.value();
    }
    final active = _activeSync;
    if (active != null) {
      return active;
    }

    final operation = _drainQueue();
    _activeSync = operation;
    return operation.whenComplete(() {
      if (identical(_activeSync, operation)) {
        _activeSync = null;
      }
    });
  }

  Future<void> _drainQueue() async {
    _isSyncing = true;
    _notifyIfAlive();
    try {
      await refreshDrafts();
      while (!_disposed && _isOnline) {
        final draft = await _store.claimNext(
          workerId: _workerId,
          now: DateTime.now(),
          leaseDuration: leaseDuration,
        );
        if (draft == null) {
          break;
        }
        await refreshDrafts();

        try {
          await _api.createReservation(
            payload: draft.payload,
            idempotencyKey: draft.idempotencyKey,
          );
          await _store.markCompleted(
            idempotencyKey: draft.idempotencyKey,
            workerId: _workerId,
            now: DateTime.now(),
          );
        } catch (error) {
          final attempt = draft.attemptCount + 1;
          final isTransient =
              error is! BookingReservationApiException || error.isTransient;
          if (isTransient && attempt < maxAttempts) {
            final delay = _retryDelay(attempt);
            final retryNow = DateTime.now();
            await _store.scheduleRetry(
              idempotencyKey: draft.idempotencyKey,
              workerId: _workerId,
              now: retryNow,
              retryAt: retryNow.add(delay),
              error: _publicError(error),
            );
            await refreshDrafts();
            continue;
          }
          await _store.markFailed(
            idempotencyKey: draft.idempotencyKey,
            workerId: _workerId,
            now: DateTime.now(),
            error: _publicError(error),
          );
        }
        await refreshDrafts();
      }
    } finally {
      _isSyncing = false;
      _notifyIfAlive();
      unawaited(_scheduleNextWakeup());
    }
  }

  Future<void> _scheduleNextWakeup() async {
    if (_disposed || !_isOnline) {
      return;
    }
    _retryTimer?.cancel();
    final DateTime? nextWakeAt;
    try {
      nextWakeAt = await _store.nextWakeAt();
    } catch (_) {
      if (!_disposed) {
        _connectivityError = 'Unable to schedule a saved reservation retry.';
        notifyListeners();
      }
      return;
    }
    if (_disposed || !_isOnline || nextWakeAt == null) {
      return;
    }
    final delay = nextWakeAt.difference(DateTime.now());
    _retryTimer = Timer(
      delay.isNegative ? Duration.zero : delay + const Duration(milliseconds: 20),
      _runInBackground,
    );
  }

  Future<void> _handleConnectivityChange(bool online) async {
    try {
      await refreshDrafts();
      if (online && !_disposed) {
        await syncNow();
      }
    } catch (_) {
      if (!_disposed) {
        _connectivityError = 'Unable to refresh saved reservation requests.';
        notifyListeners();
      }
    }
  }

  void _runInBackground() {
    unawaited(
      syncNow().catchError((Object error, StackTrace stackTrace) {
        if (!_disposed) {
          _connectivityError = 'Reservation sync is temporarily unavailable.';
          notifyListeners();
        }
      }),
    );
  }

  Duration _retryDelay(int attempt) {
    final multiplier = 1 << (attempt - 1).clamp(0, 8).toInt();
    final milliseconds = retryBaseDelay.inMilliseconds * multiplier;
    return Duration(
      milliseconds: min(milliseconds, 5 * 60 * 1000).toInt(),
    );
  }

  String _publicError(Object error) {
    if (error is BookingReservationApiException) {
      return error.toString();
    }
    return 'Network request failed. The reservation will be retried.';
  }

  void _notifyIfAlive() {
    if (!_disposed) {
      notifyListeners();
    }
  }

  static String _newWorkerId() {
    final random = Random.secure();
    return List<String>.generate(
      16,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
  }

  @override
  void dispose() {
    _disposed = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    unawaited(_connectivitySubscription?.cancel());
    super.dispose();
  }
}
