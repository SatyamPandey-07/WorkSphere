enum SolanaCurrency {
  sol('SOL'),
  usdc('USDC');

  const SolanaCurrency(this.apiValue);
  final String apiValue;
}

final RegExp base58SignatureRegex = RegExp(r'^[1-9A-HJ-NP-Za-km-z]{86,88}$');

bool isValidBase58Signature(String signature) =>
    base58SignatureRegex.hasMatch(signature.trim());

class UnsignedEscrowDeposit {
  const UnsignedEscrowDeposit({
    required this.serializedTransaction,
    required this.escrowVault,
    required this.escrowBump,
    required this.amountBaseUnits,
    required this.recentBlockhash,
    required this.bookingId,
    required this.currency,
  });

  final String serializedTransaction;
  final String escrowVault;
  final int escrowBump;
  final String amountBaseUnits;
  final String recentBlockhash;
  final String bookingId;
  final String currency;

  factory UnsignedEscrowDeposit.fromJson(Map<String, dynamic> json) {
    return UnsignedEscrowDeposit(
      serializedTransaction: (json['serializedTransaction'] ?? '').toString(),
      escrowVault: (json['escrowVault'] ?? '').toString(),
      escrowBump: (json['escrowBump'] as num?)?.toInt() ?? 0,
      amountBaseUnits: (json['amountBaseUnits'] ?? '0').toString(),
      recentBlockhash: (json['recentBlockhash'] ?? '').toString(),
      bookingId: (json['bookingId'] ?? '').toString(),
      currency: (json['currency'] ?? 'SOL').toString(),
    );
  }
}

class EscrowSettlementResult {
  const EscrowSettlementResult({
    required this.bookingId,
    required this.signature,
    required this.confirmed,
    required this.state,
  });

  final String bookingId;
  final String signature;
  final bool confirmed;
  final String state;
}

enum WalletSigningFailureKind {
  rejected,
  timeout,
  unavailable,
  invalidSignature,
}

class WalletSigningException implements Exception {
  const WalletSigningException({
    required this.kind,
    required this.message,
  });

  final WalletSigningFailureKind kind;
  final String message;

  @override
  String toString() => 'WalletSigningException(${kind.name}): $message';
}

class EscrowApiException implements Exception {
  const EscrowApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'EscrowApiException($statusCode): $message';
}

/// Abstract signer implemented by Solana Mobile Wallet Adapter (Android) or
/// Phantom deep-link bridge (iOS/fallback).
abstract interface class WalletSigner {
  Future<String> signAndSendTransaction({
    required String serializedTransactionBase64,
    required String payerWallet,
  });
}
