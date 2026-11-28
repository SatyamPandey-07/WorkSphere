import 'package:flutter_test/flutter_test.dart';
import 'package:worksphere_app/features/bookings/domain/booking_date_normalization.dart';

void main() {
  group('BookingDateNormalization', () {
    const offsets = <String, Duration>{
      'UTC-12': Duration(hours: -12),
      'UTC-8': Duration(hours: -8),
      'UTC': Duration.zero,
      'UTC+5:30': Duration(hours: 5, minutes: 30),
      'UTC+8': Duration(hours: 8),
      'UTC+12': Duration(hours: 12),
      'UTC+14': Duration(hours: 14),
    };

    for (final entry in offsets.entries) {
      test('preserves the selected day at ${entry.key}', () {
        const year = 2026;
        const month = 6;
        const day = 18;
        final localMidnightAsUtc =
            DateTime.utc(year, month, day).subtract(entry.value);

        final normalized = BookingDateNormalization.normalizeAtOffset(
          localMidnightAsUtc,
          utcOffset: entry.value,
        );

        expect(normalized, DateTime.utc(year, month, day, 12));
        expect(
          BookingDateNormalization.serializeDateOnly(normalized),
          '2026-06-18',
        );
      });
    }

    test('normalizes both sides of a spring DST transition to the same day',
        () {
      const standardOffset = Duration(hours: -5);
      const daylightOffset = Duration(hours: -4);
      final beforeTransition = BookingDateNormalization.normalizeAtOffset(
        DateTime.utc(2026, 3, 8, 6, 59, 59),
        utcOffset: standardOffset,
      );
      final afterTransition = BookingDateNormalization.normalizeAtOffset(
        DateTime.utc(2026, 3, 8, 7),
        utcOffset: daylightOffset,
      );

      expect(beforeTransition, DateTime.utc(2026, 3, 8, 12));
      expect(afterTransition, DateTime.utc(2026, 3, 8, 12));
    });

    test('normalizes repeated local times at the autumn DST transition', () {
      final firstOccurrence = BookingDateNormalization.normalizeAtOffset(
        DateTime.utc(2026, 11, 1, 5, 30),
        utcOffset: const Duration(hours: -4),
      );
      final secondOccurrence = BookingDateNormalization.normalizeAtOffset(
        DateTime.utc(2026, 11, 1, 6, 30),
        utcOffset: const Duration(hours: -5),
      );

      expect(firstOccurrence, DateTime.utc(2026, 11, 1, 12));
      expect(secondOccurrence, DateTime.utc(2026, 11, 1, 12));
    });

    test('round-trips date-only values without shifting the calendar day', () {
      final normalized =
          BookingDateNormalization.parseDateOnly('2026-11-28');

      expect(normalized, DateTime.utc(2026, 11, 28, 12));
      expect(
        BookingDateNormalization.serializeDateOnly(normalized),
        '2026-11-28',
      );
    });

    test('rejects invalid date-only values', () {
      expect(
        () => BookingDateNormalization.parseDateOnly('2026-02-30'),
        throwsFormatException,
      );
    });
  });
}
