import 'dart:convert';
import 'dart:math';

import 'package:path/path.dart' as path;
import 'package:sqflite/sqflite.dart' as sqflite;

import 'package:worksphere_app/features/bookings/domain/booking_draft.dart';

abstract interface class BookingDraftStore {
  Future<BookingDraft> enqueue(
    Map<String, dynamic> payload, {
    String? idempotencyKey,
  });

  Future<List<BookingDraft>> listDrafts();

  Future<DateTime?> nextWakeAt();

  Future<BookingDraft?> claimNext({
    required String workerId,
    required DateTime now,
    required Duration leaseDuration,
  });

  Future<void> markCompleted({
    required String idempotencyKey,
    required String workerId,
    required DateTime now,
  });

  Future<void> scheduleRetry({
    required String idempotencyKey,
    required String workerId,
    required DateTime now,
    required DateTime retryAt,
    required String error,
  });

  Future<void> markFailed({
    required String idempotencyKey,
    required String workerId,
    required DateTime now,
    required String error,
  });
}

class SqliteBookingDraftStore implements BookingDraftStore {
  SqliteBookingDraftStore._(this._database);

  final sqflite.Database _database;

  static const String _table = 'booking_drafts';

  static Future<SqliteBookingDraftStore> open({
    String databaseName = 'worksphere_booking_drafts.db',
    String? databasePath,
    sqflite.DatabaseFactory? databaseFactory,
  }) async {
    final factory = databaseFactory ?? sqflite.databaseFactory;
    final resolvedDatabasePath = databasePath ??
        path.join(await factory.getDatabasesPath(), databaseName);
    final database = await factory.openDatabase(
      resolvedDatabasePath,
      options: sqflite.OpenDatabaseOptions(
        version: 1,
        onCreate: (db, version) async {
          await db.execute('''
            CREATE TABLE $_table (
              idempotency_key TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              attempt_count INTEGER NOT NULL DEFAULT 0,
              next_attempt_at INTEGER NOT NULL,
              last_error TEXT,
              lease_owner TEXT,
              lease_expires_at INTEGER
            )
          ''');
          await db.execute(
            'CREATE INDEX booking_drafts_sync_idx '
            'ON $_table(status, next_attempt_at, lease_expires_at)',
          );
        },
      ),
    );
    return SqliteBookingDraftStore._(database);
  }

  @override
  Future<BookingDraft> enqueue(
    Map<String, dynamic> payload, {
    String? idempotencyKey,
  }) async {
    final key = idempotencyKey ?? _newIdempotencyKey();
    final now = DateTime.now();
    final encodedPayload = jsonEncode(payload);
    try {
      await _database.insert(
        _table,
        <String, Object?>{
          'idempotency_key': key,
          'payload': encodedPayload,
          'status': BookingDraftStatus.pending.name,
          'created_at': now.millisecondsSinceEpoch,
          'updated_at': now.millisecondsSinceEpoch,
          'attempt_count': 0,
          'next_attempt_at': now.millisecondsSinceEpoch,
        },
        conflictAlgorithm: sqflite.ConflictAlgorithm.abort,
      );
    } on sqflite.DatabaseException {
      final existing = await _database.query(
        _table,
        where: 'idempotency_key = ?',
        whereArgs: [key],
        limit: 1,
      );
      if (existing.isEmpty) {
        rethrow;
      }
      final draft = _fromRow(existing.single);
      if (jsonEncode(draft.payload) != encodedPayload) {
        throw StateError(
          'An idempotency key cannot be reused for a different booking.',
        );
      }
      return draft;
    }

    return BookingDraft(
      idempotencyKey: key,
      payload: Map<String, dynamic>.unmodifiable(payload),
      status: BookingDraftStatus.pending,
      createdAt: now,
      updatedAt: now,
      attemptCount: 0,
      nextAttemptAt: now,
    );
  }

  @override
  Future<List<BookingDraft>> listDrafts() async {
    final rows = await _database.query(
      _table,
      orderBy: 'created_at ASC',
    );
    return rows.map(_fromRow).toList(growable: false);
  }

  @override
  Future<DateTime?> nextWakeAt() async {
    final rows = await _database.rawQuery(
      'SELECT MIN(CASE '
      'WHEN status = ? THEN next_attempt_at '
      'WHEN status = ? THEN lease_expires_at END) AS wake_at '
      'FROM $_table WHERE status IN (?, ?)',
      [
        BookingDraftStatus.pending.name,
        BookingDraftStatus.syncing.name,
        BookingDraftStatus.pending.name,
        BookingDraftStatus.syncing.name,
      ],
    );
    final wakeAt = rows.single['wake_at'] as int?;
    return wakeAt == null
        ? null
        : DateTime.fromMillisecondsSinceEpoch(wakeAt);
  }

  @override
  Future<BookingDraft?> claimNext({
    required String workerId,
    required DateTime now,
    required Duration leaseDuration,
  }) {
    return _database.transaction((transaction) async {
      final nowMs = now.millisecondsSinceEpoch;
      final candidates = await transaction.query(
        _table,
        where: '''
          (status = ? AND next_attempt_at <= ?)
          OR (status = ? AND lease_expires_at <= ?)
        ''',
        whereArgs: [
          BookingDraftStatus.pending.name,
          nowMs,
          BookingDraftStatus.syncing.name,
          nowMs,
        ],
        orderBy: 'created_at ASC',
        limit: 1,
      );
      if (candidates.isEmpty) {
        return null;
      }

      final key = candidates.single['idempotency_key']! as String;
      final updated = await transaction.update(
        _table,
        <String, Object?>{
          'status': BookingDraftStatus.syncing.name,
          'updated_at': nowMs,
          'lease_owner': workerId,
          'lease_expires_at':
              now.add(leaseDuration).millisecondsSinceEpoch,
        },
        where: 'idempotency_key = ? AND ('
            '(status = ? AND next_attempt_at <= ?) OR '
            '(status = ? AND lease_expires_at <= ?))',
        whereArgs: [
          key,
          BookingDraftStatus.pending.name,
          nowMs,
          BookingDraftStatus.syncing.name,
          nowMs,
        ],
      );
      if (updated != 1) {
        return null;
      }
      final rows = await transaction.query(
        _table,
        where: 'idempotency_key = ? AND lease_owner = ?',
        whereArgs: [key, workerId],
        limit: 1,
      );
      return rows.isEmpty ? null : _fromRow(rows.single);
    });
  }

  @override
  Future<void> markCompleted({
    required String idempotencyKey,
    required String workerId,
    required DateTime now,
  }) async {
    await _updateClaimed(
      idempotencyKey: idempotencyKey,
      workerId: workerId,
      values: <String, Object?>{
        'status': BookingDraftStatus.completed.name,
        'updated_at': now.millisecondsSinceEpoch,
        'last_error': null,
        'lease_owner': null,
        'lease_expires_at': null,
      },
      incrementAttemptCount: true,
    );
  }

  @override
  Future<void> scheduleRetry({
    required String idempotencyKey,
    required String workerId,
    required DateTime now,
    required DateTime retryAt,
    required String error,
  }) async {
    await _updateClaimed(
      idempotencyKey: idempotencyKey,
      workerId: workerId,
      values: <String, Object?>{
        'status': BookingDraftStatus.pending.name,
        'updated_at': now.millisecondsSinceEpoch,
        'next_attempt_at': retryAt.millisecondsSinceEpoch,
        'last_error': error,
        'lease_owner': null,
        'lease_expires_at': null,
      },
      incrementAttemptCount: true,
    );
  }

  @override
  Future<void> markFailed({
    required String idempotencyKey,
    required String workerId,
    required DateTime now,
    required String error,
  }) async {
    await _updateClaimed(
      idempotencyKey: idempotencyKey,
      workerId: workerId,
      values: <String, Object?>{
        'status': BookingDraftStatus.failed.name,
        'updated_at': now.millisecondsSinceEpoch,
        'last_error': error,
        'lease_owner': null,
        'lease_expires_at': null,
      },
      incrementAttemptCount: true,
    );
  }

  Future<void> _updateClaimed({
    required String idempotencyKey,
    required String workerId,
    required Map<String, Object?> values,
    bool incrementAttemptCount = false,
  }) async {
    final assignments = values.keys.map((column) => '$column = ?').toList();
    if (incrementAttemptCount) {
      assignments.add('attempt_count = attempt_count + 1');
    }
    final updated = await _database.rawUpdate(
      'UPDATE $_table SET ${assignments.join(', ')} '
      'WHERE idempotency_key = ? AND status = ? AND lease_owner = ?',
      <Object?>[
        ...values.values,
        idempotencyKey,
        BookingDraftStatus.syncing.name,
        workerId,
      ],
    );
    if (updated != 1) {
      throw StateError('The booking draft sync lease is no longer owned.');
    }
  }

  BookingDraft _fromRow(Map<String, Object?> row) {
    final payload = jsonDecode(row['payload']! as String);
    if (payload is! Map<String, dynamic>) {
      throw const FormatException('Stored booking payload is invalid.');
    }
    return BookingDraft(
      idempotencyKey: row['idempotency_key']! as String,
      payload: Map<String, dynamic>.unmodifiable(payload),
      status: BookingDraftStatus.values.byName(row['status']! as String),
      createdAt: DateTime.fromMillisecondsSinceEpoch(row['created_at']! as int),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(row['updated_at']! as int),
      attemptCount: row['attempt_count']! as int,
      nextAttemptAt:
          DateTime.fromMillisecondsSinceEpoch(row['next_attempt_at']! as int),
      lastError: row['last_error'] as String?,
    );
  }

  static String _newIdempotencyKey() {
    final random = Random.secure();
    final bytes = List<String>.generate(
      16,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    return 'booking_$bytes';
  }

  Future<void> close() => _database.close();
}
