import 'dart:convert';

class NomadDeskPass {
  const NomadDeskPass({
    required this.bookingId,
    required this.venueName,
    required this.qrPayload,
    this.expiresAt,
  });

  final String bookingId;
  final String venueName;
  final String qrPayload;
  final DateTime? expiresAt;

  factory NomadDeskPass.forBooking({
    required String bookingId,
    required String venueName,
    DateTime? expiresAt,
  }) {
    return NomadDeskPass(
      bookingId: bookingId,
      venueName: venueName,
      qrPayload: 'worksphere://pass/${Uri.encodeComponent(bookingId)}',
      expiresAt: expiresAt,
    );
  }

  Map<String, Object?> toJson() => {
        'bookingId': bookingId,
        'venueName': venueName,
        'qrPayload': qrPayload,
        'expiresAt': expiresAt?.toUtc().toIso8601String(),
      };

  String encode() => jsonEncode(toJson());

  factory NomadDeskPass.decode(String source) {
    final decoded = jsonDecode(source);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Pass cache must contain an object.');
    }

    final bookingId = decoded['bookingId'];
    final venueName = decoded['venueName'];
    final qrPayload = decoded['qrPayload'];
    final expiresAtValue = decoded['expiresAt'];
    if (bookingId is! String ||
        bookingId.trim().isEmpty ||
        venueName is! String ||
        qrPayload is! String ||
        qrPayload.trim().isEmpty ||
        (expiresAtValue != null && expiresAtValue is! String)) {
      throw const FormatException('Pass cache contains invalid fields.');
    }

    final expiresAt = expiresAtValue == null
        ? null
        : DateTime.tryParse(expiresAtValue as String);
    if (expiresAtValue != null && expiresAt == null) {
      throw const FormatException('Pass cache expiry is invalid.');
    }

    return NomadDeskPass(
      bookingId: bookingId,
      venueName: venueName,
      qrPayload: qrPayload,
      expiresAt: expiresAt,
    );
  }
}
