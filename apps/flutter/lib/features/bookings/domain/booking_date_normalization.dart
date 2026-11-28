class BookingDateNormalization {
  const BookingDateNormalization._();

  /// Stores a selected calendar day as UTC noon, independent of local midnight.
  static DateTime normalize(DateTime selectedDate) {
    return DateTime.utc(
      selectedDate.year,
      selectedDate.month,
      selectedDate.day,
      12,
    );
  }

  /// Reads a calendar day from an instant as it appears at [utcOffset].
  static DateTime normalizeAtOffset(
    DateTime instant, {
    required Duration utcOffset,
  }) {
    final dateAtOffset = instant.toUtc().add(utcOffset);
    return normalize(dateAtOffset);
  }

  /// Converts a normalized date back to a local date for Flutter's picker.
  static DateTime toPickerDate(DateTime normalizedDate) {
    return DateTime(
      normalizedDate.year,
      normalizedDate.month,
      normalizedDate.day,
    );
  }

  /// Serializes only the calendar date, without applying a timezone offset.
  static String serializeDateOnly(DateTime date) {
    final normalized = normalize(date);
    final year = normalized.year.toString().padLeft(4, '0');
    final month = normalized.month.toString().padLeft(2, '0');
    final day = normalized.day.toString().padLeft(2, '0');
    return '$year-$month-$day';
  }

  /// Parses a date-only value into the canonical UTC-noon representation.
  static DateTime parseDateOnly(String value) {
    final match = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(value);
    if (match == null) {
      throw FormatException('Expected a date in YYYY-MM-DD format.', value);
    }

    final year = int.parse(match.group(1)!);
    final month = int.parse(match.group(2)!);
    final day = int.parse(match.group(3)!);
    final parsed = DateTime.utc(year, month, day, 12);
    if (parsed.year != year || parsed.month != month || parsed.day != day) {
      throw FormatException('Invalid calendar date.', value);
    }
    return parsed;
  }
}
