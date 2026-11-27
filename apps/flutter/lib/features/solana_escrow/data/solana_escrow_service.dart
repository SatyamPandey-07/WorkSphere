import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:worksphere_app/features/solana_escrow/domain/escrow_models.dart';

class SolanaEscrowService {
  SolanaEscrowService({
    required this.baseUri,
    required this.tokenProvider,
    http.Client? client,
    this.signingTimeout = const Duration(seconds: 60),
  }) : _client = client ?? http.Client();

  final Uri baseUri;
  final Future<String?> Function() tokenProvider;
  final http.Client _client;
  final Duration signingTimeout;

  Uri get _endpoint => baseUri.replace(path: '/api/pay/solana');

  Future<Map<String, String>> _headers() async {
    final token = await tokenProvider();
    return <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }

  /// Requests an unsigned serialized escrow deposit transaction from
  /// `POST /api/pay/solana`.
  Future<UnsignedEscrowDeposit> requestUnsignedDeposit({
    required String bookingId,
    required String payerWallet,
    required double amount,
    required SolanaCurrency currency,
  }) async {
    final response = await _client.post(
      _endpoint,
      headers: await _headers(),
      body: jsonEncode(<String, dynamic>{
        'bookingId': bookingId,
        'payerWallet': payerWallet,
        'amount': amount,
        'currency': currency.apiValue,
      }),
    );

    final decoded = _decodeJsonMap(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EscrowApiException(
        decoded['error']?.toString() ??
            'Failed to build escrow transaction (HTTP ${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    final data = decoded['data'];
    if (data is! Map<String, dynamic>) {
      throw const EscrowApiException('Malformed /api/pay/solana deposit data');
    }

    final deposit = UnsignedEscrowDeposit.fromJson(data);
    if (deposit.serializedTransaction.isEmpty) {
      throw const EscrowApiException('Missing serializedTransaction in response');
    }
    return deposit;
  }

  /// Confirms settlement for a signed escrow deposit transaction via
  /// `POST /api/pay/solana` (`action: "confirm"`).
  Future<EscrowSettlementResult> confirmDeposit({
    required String bookingId,
    required String payerWallet,
    required double amount,
    required SolanaCurrency currency,
    required String signature,
  }) async {
    final response = await _client.post(
      _endpoint,
      headers: await _headers(),
      body: jsonEncode(<String, dynamic>{
        'action': 'confirm',
        'bookingId': bookingId,
        'payerWallet': payerWallet,
        'amount': amount,
        'currency': currency.apiValue,
        'signature': signature,
      }),
    );

    final decoded = _decodeJsonMap(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EscrowApiException(
        decoded['error']?.toString() ??
            'Failed to confirm escrow deposit (HTTP ${response.statusCode})',
        statusCode: response.statusCode,
      );
    }

    final data = decoded['data'];
    final state = data is Map<String, dynamic>
        ? (data['state']?.toString() ?? 'confirmed')
        : 'confirmed';

    return EscrowSettlementResult(
      bookingId: bookingId,
      signature: signature,
      confirmed: true,
      state: state,
    );
  }

  /// End-to-end flow: build unsigned tx -> sign via MWA/deep-link -> confirm.
  /// Handles wallet rejection and signing timeout gracefully via typed
  /// [WalletSigningException] errors without calling confirmation.
  Future<EscrowSettlementResult> depositAndConfirm({
    required String bookingId,
    required String payerWallet,
    required double amount,
    required SolanaCurrency currency,
    required WalletSigner signer,
  }) async {
    final unsigned = await requestUnsignedDeposit(
      bookingId: bookingId,
      payerWallet: payerWallet,
      amount: amount,
      currency: currency,
    );

    final String signature;
    try {
      signature = await signer
          .signAndSendTransaction(
            serializedTransactionBase64: unsigned.serializedTransaction,
            payerWallet: payerWallet,
          )
          .timeout(signingTimeout);
    } on TimeoutException {
      throw WalletSigningException(
        kind: WalletSigningFailureKind.timeout,
        message:
            'Wallet signing timed out after ${signingTimeout.inSeconds}s. Please try again.',
      );
    } on WalletSigningException {
      rethrow;
    } catch (err) {
      throw WalletSigningException(
        kind: WalletSigningFailureKind.unavailable,
        message: err.toString(),
      );
    }

    if (!isValidBase58Signature(signature)) {
      throw const WalletSigningException(
        kind: WalletSigningFailureKind.invalidSignature,
        message: 'Wallet returned an invalid Solana transaction signature.',
      );
    }

    return confirmDeposit(
      bookingId: bookingId,
      payerWallet: payerWallet,
      amount: amount,
      currency: currency,
      signature: signature.trim(),
    );
  }

  Map<String, dynamic> _decodeJsonMap(String body) {
    try {
      final parsed = jsonDecode(body);
      return parsed is Map<String, dynamic> ? parsed : const {};
    } catch (_) {
      return const {};
    }
  }
}
