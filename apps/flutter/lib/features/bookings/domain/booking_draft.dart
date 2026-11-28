enum BookingDraftStatus {
  pending,
  syncing,
  completed,
  failed,
}

class BookingDraft {
  const BookingDraft({
    required this.idempotencyKey,
    required this.payload,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
    required this.attemptCount,
    required this.nextAttemptAt,
    this.lastError,
  });

  final String idempotencyKey;
  final Map<String, dynamic> payload;
  final BookingDraftStatus status;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int attemptCount;
  final DateTime nextAttemptAt;
  final String? lastError;
}
