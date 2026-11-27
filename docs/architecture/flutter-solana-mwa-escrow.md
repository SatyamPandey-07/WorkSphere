# WorkSphere Flutter Solana Mobile Wallet Adapter (MWA) & Deep-Link Escrow Integration

Documents how Flutter (`apps/flutter/`) requests unsigned escrow deposit transactions from `POST /api/pay/solana`, signs them via **Solana Mobile Wallet Adapter (MWA)** on Android or **Phantom Universal/Deep Links** on iOS/fallback, handles transaction serialization, and tracks confirmation/settlement.

---

## 1. Backend Escrow Contract (`src/app/api/pay/solana/route.ts`)

### 1.1 Build Unsigned Deposit (`POST /api/pay/solana`)

* **Auth & Rate Limit:** Requires Clerk JWT (`401` if missing) and is rate-limited per user (`solana-pay:${userId}`, 10 req window, `429` on excess).
* **Request Body (`action: "deposit"`, default):**
  ```json
  {
    "bookingId": "bk_123",
    "payerWallet": "<base58-pubkey>",
    "amount": 0.25,
    "currency": "SOL"
  }
  ```
* **Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "serializedTransaction": "<base64-legacy-transaction>",
      "escrowVault": "<base58-pda>",
      "escrowBump": 254,
      "amountBaseUnits": "250000000",
      "recentBlockhash": "<base58-blockhash>",
      "bookingId": "bk_123",
      "currency": "SOL"
    }
  }
  ```
* **Pre-flight Errors:** `400` (`EscrowDepositPreflightError` / invalid params / cancelled booking), `403` (not booking owner), `404` (booking not found), `503` (`BALANCE_CHECK_FAILED` / `RPC_REQUEST_FAILED`).

### 1.2 Confirmation & Registration Actions

* **`POST /api/pay/solana` (`action: "confirm"`):** Validates `{ bookingId, payerWallet, amount, currency, signature, serializedTransaction? }`. If `serializedTransaction` is supplied, runs quorum simulation (`202 Accepted` optimistic state); otherwise runs `confirmTransaction` + `verifyDeposit` and persists `SolanaEscrow`.
* **`POST /api/pay/solana` (`action: "register_deposit"`):** Registers a Base58 transaction signature (`^[1-9A-HJ-NP-Za-km-z]{86,88}$`) against `bookingId` before/during settlement.

---

## 2. Transaction Serialization Between `/api/pay/solana` and Wallets

`buildDepositTransaction` (`src/lib/solana/escrowClient.ts`) constructs a legacy `@solana/web3.js` `Transaction` (including `ComputeBudgetProgram.setComputeUnitPrice` priority fee and escrow deposit instructions) and serializes it with:

```ts
transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
```

Mobile wallet transports require different wire encodings:

| Transport | Expected Transaction Encoding | Returned Artifact | Conversion in Dart |
| :--- | :--- | :--- | :--- |
| **Android MWA (`solana_mobile_client`)** | Raw `Uint8List` wire bytes | `Uint8List` signed tx / 64-byte signature | `base64Decode(serializedTransaction)` directly |
| **Phantom Deep Link (`/ul/v1/signAndSendTransaction`)** | **Base58** string inside NaCl-encrypted JSON payload | Base58 `signature` (86–88 chars) | `base58Encode(base64Decode(serializedTransaction))` |

> **Blockhash TTL Warning:** `recentBlockhash` is valid for ~150 slots (~60–90 seconds; `SOLANA_PAY_DEFAULT_TIMEOUT_MS` ceiling is 5 minutes). If signing is delayed beyond `lastValidBlockHeight`, **never** re-sign the stale transaction—request a fresh unsigned transaction from `POST /api/pay/solana`.

---

## 3. Signing Flows (Android MWA & Phantom Deep Links)

### 3.1 Android: Solana Mobile Wallet Adapter (`solana_mobile_client`)

```dart
Future<String> signAndSendViaMwa({
  required Uint8List unsignedTxBytes,
  required String cluster, // e.g. 'mainnet-beta' or 'devnet'
}) async {
  final session = await LocalAssociationScenario.create();
  session.startActivityForResult(null).ignore();
  try {
    final client = await session.start();
    final auth = await client.authorize(
      identityUri: Uri.parse('https://worksphere.app'),
      iconUri: Uri.parse('favicon.ico'),
      identityName: 'WorkSphere',
      cluster: cluster,
    );
    if (auth == null) {
      throw WalletRejectedException('Wallet authorization cancelled');
    }

    final result = await client.signAndSendTransactions(
      transactions: [unsignedTxBytes],
    );
    if (result.signatures.isEmpty) {
      throw WalletRejectedException('No signature returned by wallet');
    }
    return base58Encode(result.signatures.first);
  } finally {
    await session.close();
  }
}
```

* **Error Mapping:** Catch `PlatformException` / `JsonRpcException` for user rejection (`-32000` / authorization declined), missing MWA-compatible wallet (`ActivityNotFoundException` -> fall back to Phantom Universal Link), and `TimeoutException` (`60s` association timeout).

### 3.2 iOS & Fallback: Phantom Deep Links (`app_links` + X25519 NaCl Box)

1. Generate an ephemeral X25519 keypair (`dappPublicKey`, `dappSecretKey`) in memory for the signing session.
2. **Connect (`worksphere://solana/connect`):** Launch `https://phantom.app/ul/v1/connect` with `app_url`, `dapp_encryption_public_key`, `cluster`, and `redirect_link`. Decrypt `data` using Phantom's `phantom_encryption_public_key` + `nonce` to obtain `public_key` and `session`.
3. **Sign & Send (`worksphere://solana/signed`):**
   * Convert `base64Decode(serializedTransaction)` -> Base58 string.
   * Encrypt `jsonEncode({ "transaction": base58Tx, "session": sessionToken })` with NaCl box.
   * Launch `https://phantom.app/ul/v1/signAndSendTransaction`.
4. **Callback Handling & Timeouts:**
   * Listen on `app_links` URI stream with a `120s` timeout timer (cancelled in `dispose()`).
   * If callback contains `errorCode=4001`, surface a non-fatal "Transaction cancelled in wallet" state so the user can retry.
   * If callback contains `signature`, validate against `^[1-9A-HJ-NP-Za-km-z]{86,88}$` before confirmation polling.

---

## 4. Confirmation Streaming & Polling (`GET` / `POST /api/pay/solana`)

Once `signature` is obtained:

1. **Register Signature:** Call `POST /api/pay/solana` with `{ action: "register_deposit", bookingId, payerWallet, signature, amount, currency }`.
2. **Primary — SSE Confirmation Stream (`GET /api/pay/solana?bookingId=<id>&signature=<sig>`):**
   * Server emits `connected`, `status` (`processed` -> `confirmed` -> `finalized` | `failed`), `heartbeat` (every `15,000 ms`), and `refresh` (`session_budget_refresh` before route timeout).
   * Transition local booking UI to provisionally reserved immediately upon `processed`, confirmed on `confirmed`, and finalized on `finalized`.
3. **Fallback — Bounded Confirmation Polling (`DEFAULT_POLL_INTERVAL_MS = 2_000 ms`, `DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000 ms`):**
   * If SSE disconnects repeatedly or is blocked, poll `POST /api/pay/solana` (`action: "confirm"`) or RPC `getSignatureStatuses([signature], { searchTransactionHistory: true })` every `2s` up to `60s`.
   * Stop immediately on terminal `finalized` or `err != null` (roll back provisional seat hold on failure/expiry).
   * Respect HTTP `429` responses using exponential backoff / fallback RPC rotation (`solanaPayEscrow.ts` opens circuit after `3` consecutive `429` responses with `30,000 ms` cooldown).

```text
Flutter App                /api/pay/solana              MWA / Phantom Wallet         Solana RPC
    |                             |                              |                       |
    |-- 1. POST deposit --------->|                              |                       |
    |<-- base64 unsigned tx ------|                              |                       |
    |                                                            |                       |
    |-- 2. Decode base64 (-> base58 for Phantom) --------------->|                       |
    |                                 [User approves/signs]      |-- 3. sendRawTx ------>|
    |<-- 4. Base58 signature ------------------------------------|                       |
    |                             |                                                      |
    |-- 5. POST register_deposit->|                                                      |
    |-- 6. GET SSE / poll confirm>|--------------- 7. getSignatureStatuses ------------->|
    |<-- 8. confirmed / finalized-|                                                      |
```
