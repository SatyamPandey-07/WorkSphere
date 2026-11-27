import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:worksphere_app/features/solana_escrow/data/solana_escrow_service.dart';
import 'package:worksphere_app/features/solana_escrow/domain/escrow_models.dart';

class _FakeWalletSigner implements WalletSigner {
  _FakeWalletSigner(this.handler);

  final Future<String> Function(String txBase64, String payerWallet) handler;

  @override
  Future<String> signAndSendTransaction({
    required String serializedTransactionBase64,
    required String payerWallet,
  }) {
    return handler(serializedTransactionBase64, payerWallet);
  }
}

void main() {
  final baseUri = Uri.parse('https://worksphere.app');
  const validSignature =
      '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  const walletPubkey = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

  group('SolanaEscrowService', () {
    test('requests unsigned tx, signs via wallet, and confirms settlement',
        () async {
      final recordedActions = <String>[];
      final client = MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        final action = (body['action'] ?? 'deposit').toString();
        recordedActions.add(action);

        if (action == 'deposit') {
          return http.Response(
            jsonEncode({
              'success': true,
              'data': {
                'serializedTransaction': 'AQIDBA==',
                'escrowVault': 'EscrowVault11111111111111111111111111111111',
                'escrowBump': 254,
                'amountBaseUnits': '250000000',
                'recentBlockhash': '11111111111111111111111111111111',
                'bookingId': 'bk_1',
                'currency': 'SOL',
              },
            }),
            200,
          );
        }

        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'state': 'confirmed',
              'bookingId': 'bk_1',
              'signature': validSignature,
            },
          }),
          200,
        );
      });

      final service = SolanaEscrowService(
        baseUri: baseUri,
        tokenProvider: () async => 'clerk_jwt',
        client: client,
      );

      final result = await service.depositAndConfirm(
        bookingId: 'bk_1',
        payerWallet: walletPubkey,
        amount: 0.25,
        currency: SolanaCurrency.sol,
        signer: _FakeWalletSigner((txBase64, _) async {
          expect(txBase64, 'AQIDBA==');
          return validSignature;
        }),
      );

      expect(recordedActions, ['deposit', 'confirm']);
      expect(result.confirmed, isTrue);
      expect(result.signature, validSignature);
      expect(result.state, 'confirmed');
    });

    test('handles wallet rejection gracefully without confirming', () async {
      var confirmCalled = false;
      final client = MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['action'] == 'confirm') {
          confirmCalled = true;
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'serializedTransaction': 'AQIDBA==',
              'escrowVault': 'EscrowVault11111111111111111111111111111111',
              'escrowBump': 254,
              'amountBaseUnits': '250000000',
              'recentBlockhash': '11111111111111111111111111111111',
              'bookingId': 'bk_2',
              'currency': 'SOL',
            },
          }),
          200,
        );
      });

      final service = SolanaEscrowService(
        baseUri: baseUri,
        tokenProvider: () async => 'clerk_jwt',
        client: client,
      );

      await expectLater(
        () => service.depositAndConfirm(
          bookingId: 'bk_2',
          payerWallet: walletPubkey,
          amount: 0.25,
          currency: SolanaCurrency.sol,
          signer: _FakeWalletSigner((_, __) async {
            throw const WalletSigningException(
              kind: WalletSigningFailureKind.rejected,
              message: 'User rejected transaction in wallet',
            );
          }),
        ),
        throwsA(
          isA<WalletSigningException>().having(
            (e) => e.kind,
            'kind',
            WalletSigningFailureKind.rejected,
          ),
        ),
      );
      expect(confirmCalled, isFalse);
    });

    test('handles wallet signing timeout gracefully without confirming',
        () async {
      var confirmCalled = false;
      final client = MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['action'] == 'confirm') {
          confirmCalled = true;
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'serializedTransaction': 'AQIDBA==',
              'escrowVault': 'EscrowVault11111111111111111111111111111111',
              'escrowBump': 254,
              'amountBaseUnits': '250000000',
              'recentBlockhash': '11111111111111111111111111111111',
              'bookingId': 'bk_3',
              'currency': 'SOL',
            },
          }),
          200,
        );
      });

      final service = SolanaEscrowService(
        baseUri: baseUri,
        tokenProvider: () async => 'clerk_jwt',
        client: client,
        signingTimeout: const Duration(milliseconds: 20),
      );

      await expectLater(
        () => service.depositAndConfirm(
          bookingId: 'bk_3',
          payerWallet: walletPubkey,
          amount: 0.25,
          currency: SolanaCurrency.sol,
          signer: _FakeWalletSigner((_, __) => Completer<String>().future),
        ),
        throwsA(
          isA<WalletSigningException>().having(
            (e) => e.kind,
            'kind',
            WalletSigningFailureKind.timeout,
          ),
        ),
      );
      expect(confirmCalled, isFalse);
    });

    test('rejects invalid signature format before calling confirm', () async {
      var confirmCalled = false;
      final client = MockClient((request) async {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        if (body['action'] == 'confirm') {
          confirmCalled = true;
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'serializedTransaction': 'AQIDBA==',
              'escrowVault': 'EscrowVault11111111111111111111111111111111',
              'escrowBump': 254,
              'amountBaseUnits': '250000000',
              'recentBlockhash': '11111111111111111111111111111111',
              'bookingId': 'bk_4',
              'currency': 'SOL',
            },
          }),
          200,
        );
      });

      final service = SolanaEscrowService(
        baseUri: baseUri,
        tokenProvider: () async => 'clerk_jwt',
        client: client,
      );

      await expectLater(
        () => service.depositAndConfirm(
          bookingId: 'bk_4',
          payerWallet: walletPubkey,
          amount: 0.25,
          currency: SolanaCurrency.sol,
          signer: _FakeWalletSigner((_, __) async => 'not-a-valid-sig'),
        ),
        throwsA(
          isA<WalletSigningException>().having(
            (e) => e.kind,
            'kind',
            WalletSigningFailureKind.invalidSignature,
          ),
        ),
      );
      expect(confirmCalled, isFalse);
    });
  });
}
