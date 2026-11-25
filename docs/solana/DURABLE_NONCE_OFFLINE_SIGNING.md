# Solana Durable Nonce Offline Transaction Signing Runbook

> **Operational Engineering Runbook & Architectural Reference**  
> **Status:** Operational Procedure / Architecture Guide  
> **Target Subsystems:** Solana Payments & Escrows (`src/lib/payments/solanaPay.ts`, `src/lib/solana/solanaPayEscrow.ts`, `src/hooks/useSolanaSeatEscrow.ts`)  
> **SDK Compatibility:** `@solana/web3.js` v1.99.x  
> **Related Documentation:** [`docs/solana/ESCROW_SETTLEMENT_RUNBOOK.md`](./ESCROW_SETTLEMENT_RUNBOOK.md), [`docs/solana/DURABLE_NONCE_SPECIFICATION.md`](./DURABLE_NONCE_SPECIFICATION.md), and [`docs/solana/SOLANA_ESCROW_REFUND_CRON.md`](./SOLANA_ESCROW_REFUND_CRON.md)

---

## A. Overview

In standard Solana transaction processing, every transaction must reference a recent cluster blockhash in its `recentBlockhash` header field.

### Why Ordinary Blockhashes Fail in Intermittent or Offline Conditions
- **Blockhash Lifespan:** A Solana block is produced every ~400 milliseconds. Recent blockhashes are tracked in a 300-slot commitment window, remaining valid on-chain for only ~150 slots—approximately **60 to 90 seconds** of real wall-clock time.
- **The Nomad Disconnection Bottleneck:** Digital nomads working from trains, basements, remote coworking hubs, or long-haul flights experience prolonged connectivity dropouts. If a transaction is prepared and signed while connected, any network disruption exceeding 90 seconds renders the transaction permanently expired (`BlockhashNotFound`).
- **Cold-Storage & Air-Gapped Delays:** Secure multi-signature operations, hardware wallet inspections (e.g., Ledger, Keystone), and multi-party escrow release approvals cannot be reliably reviewed, physically signed across air-gapped QR/USB transfers, and broadcast within a 60-second window.

### The Purpose of Durable Nonce Transactions
A **Durable Nonce** replaces the ephemeral cluster blockhash with a persistent 32-byte value stored inside an on-chain **Nonce Account** owned by the Solana System Program.
- **Long-Lived Validity:** The transaction remains valid indefinitely until the stored nonce value is explicitly advanced or the account is closed.
- **Replay Protection via Nonce Advance:** The transaction must include `SystemProgram.nonceAdvance` as its very first instruction. When executed, validators update the stored nonce to a fresh blockhash in the same atomic block, preventing double-spend or replay attacks.
- **Offline Signing Enabler:** An online preparation server can assemble an escrow settlement transaction, serialize the message, and hand it off to an air-gapped signing device. Once signed, the payload can be held for hours or days and broadcast whenever connectivity returns.

### WorkSphere Escrow Context
In WorkSphere's desk booking ecosystem, durable nonces apply directly to:
1. **Pre-Authorized Desk Escrow Deposits:** Locking SOL or USDC collateral before entering transit with no guaranteed internet.
2. **Cold-Storage Venue Escrow Settlements:** Coworking venue owners authorizing large escrow disbursements via multi-sig cold storage.
3. **Delayed Refund Claims:** Claiming balance refunds following a dispute even if the user is intermittently offline.

---

## B. Standard Blockhash vs Durable Nonce

| Dimension | Standard Recent Blockhash | Durable Nonce Transaction |
| :--- | :--- | :--- |
| **Blockhash Source** | Cluster `getLatestBlockhash()` | Stored value in on-chain Nonce Account |
| **Transaction Validity Period** | ~150 slots (~60–90 seconds) | **Indefinite** (until nonce is advanced or closed) |
| **Offline Signing Suitability** | Unsuitable (expires during inspection) | **Ideal** (supports multi-hour / multi-day air-gaps) |
| **Nonce Account Requirement** | None | Dedicated 80-byte System Program account |
| **Account Rent Exemption** | N/A | Must hold minimum rent-exempt balance (~0.00144 SOL) |
| **Transaction Composition** | Arbitrary instructions | **First instruction must be `SystemProgram.nonceAdvance`** |
| **Concurrency Limit** | Unbounded parallel transactions | **Strictly 1 in-flight transaction per nonce account** |
| **Replay & Ordering** | Blockhash expiration prevents replays | Nonce advancement updates stored hash atomically |
| **Failure Recovery** | Re-fetch new blockhash and re-sign | Re-fetch advanced nonce, reconstruct, and re-sign |

---

## C. Durable Nonce Account Initialization

A durable nonce account is an 80-byte account (`NONCE_ACCOUNT_LENGTH`) owned by the System Program (`11111111111111111111111111111111`).

### Step-by-Step Initialization Procedure

1. **Generate or Select Nonce Account Keypair:**
   Generate a dedicated keypair for the nonce account (`nonceKeypair`).
2. **Calculate Rent-Exempt Reserve:**
   Query `connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH)`. For 80 bytes, this is approximately 1,439,520 lamports (~0.00144 SOL).
3. **Construct Creation Instruction:**
   Use `SystemProgram.createAccount()` with:
   - `fromPubkey`: Funding wallet (fee payer).
   - `newAccountPubkey`: `nonceKeypair.publicKey`.
   - `lamports`: Minimum rent-exempt balance.
   - `space`: `NONCE_ACCOUNT_LENGTH` (80 bytes).
   - `programId`: `SystemProgram.programId`.
4. **Construct Initialization Instruction:**
   Use `SystemProgram.nonceInitialize()` with:
   - `noncePubkey`: `nonceKeypair.publicKey`.
   - `authorizedPubkey`: The authorized authority allowed to advance or withdraw the nonce.
5. **Assemble and Submit Transaction:**
   Combine both instructions into a single transaction, sign with both `payer` and `nonceKeypair`, and submit to the cluster.
6. **Verify Initialization:**
   Fetch account info via `connection.getAccountInfo()` or `connection.getNonce()`. Ensure account state is `Initialized` and extract the 32-byte stored nonce blockhash.

### Role Responsibilities and Security Constraints
- **Required Signers:** Both the funding account (payer) and the new `nonceKeypair` must sign the creation transaction.
- **Account Ownership:** The account must be assigned to `SystemProgram.programId`.
- **Authority Management:** The `authorizedPubkey` controls advancing and withdrawing. If the authority key is lost, funds in the nonce account cannot be recovered.
- **Failure Scenarios:** Underfunding below the rent-exempt reserve causes `createAccount` to fail. Supplying an already existing account address causes transaction simulation to abort.

---

## D. Durable Nonce Transaction Construction

A valid durable nonce transaction must adhere strictly to instruction ordering and account authorization rules.

### Mandatory Construction Sequence

1. **Fetch Nonce Account State:**
   Retrieve the latest account data via `connection.getNonce(noncePubkey, 'confirmed')`.
2. **Extract Nonce Hash:**
   Read the 32-byte stored hash: `nonceAccount.nonce`.
3. **Construct Nonce Advance Instruction:**
   Create `SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey })`.
4. **Construct Application Instructions:**
   Assemble the actual business instructions (e.g., `SystemProgram.transfer`, SPL Token transfer, or seat escrow deposit/release).
5. **Set `recentBlockhash` to Durable Nonce:**
   Set `transaction.recentBlockhash = nonceAccount.nonce`.
6. **Set `feePayer`:**
   Assign the fee payer's public key (`transaction.feePayer = payerPubkey`).
7. **Assemble Instructions in Strict Order:**
   **The `nonceAdvance` instruction MUST be the very first instruction in `transaction.instructions[0]`.** Any business logic instructions must follow.
8. **Collect Signatures:**
   All required accounts (fee payer, nonce authority, and transfer authority) must sign the transaction.

### Roles and Signer Distinction

| Role | Responsibility | Must Sign? | Can be Same Entity? |
| :--- | :--- | :--- | :--- |
| **Nonce Account** | Holds stored nonce state and rent balance | No (only at creation) | No (dedicated account) |
| **Nonce Authority** | Authorizes advancing the nonce | **Yes** | Yes, can equal Fee Payer |
| **Fee Payer** | Pays transaction network fees | **Yes** | Yes |
| **Transfer / Escrow Authority** | Authorizes moving funds or changing escrow state | **Yes** | Yes, can equal Nonce Authority |
| **Recipient / Venue** | Receives transfer or escrow settlement | No | Yes |

### Illustrative Implementation (@solana/web3.js 1.99.x)

```typescript
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  NONCE_ACCOUNT_LENGTH,
} from "@solana/web3.js";

export interface BuildDurableNonceTxParams {
  connection: Connection;
  noncePubkey: PublicKey;
  nonceAuthority: PublicKey;
  feePayer: PublicKey;
  recipient: PublicKey;
  lamports: number;
}

/**
 * Constructs an offline-ready durable nonce transfer transaction.
 * Compliant with @solana/web3.js v1.99.x specifications.
 */
export async function buildDurableNonceTransferTx(
  params: BuildDurableNonceTxParams
): Promise<Transaction> {
  const { connection, noncePubkey, nonceAuthority, feePayer, recipient, lamports } = params;

  // 1. Fetch current on-chain nonce state
  const nonceAccountInfo = await connection.getAccountInfo(noncePubkey, "confirmed");
  if (!nonceAccountInfo) {
    throw new Error(`Nonce account ${noncePubkey.toBase58()} not found`);
  }

  const nonceAccount = connection.getNonce
    ? await connection.getNonce(noncePubkey, "confirmed")
    : null;

  if (!nonceAccount) {
    throw new Error("Failed to parse nonce account data");
  }

  // 2. Instantiate transaction
  const tx = new Transaction();

  // 3. Instruction 0 MUST be nonceAdvance
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey,
      authorizedPubkey: nonceAuthority,
    })
  );

  // 4. Instruction 1..n: Business instructions (e.g. transfer or escrow release)
  tx.add(
    SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: recipient,
      lamports,
    })
  );

  // 5. Assign durable nonce hash as recentBlockhash and designate fee payer
  tx.recentBlockhash = nonceAccount.nonce;
  tx.feePayer = feePayer;

  return tx;
}
```

---

## E. Offline Signing Workflow

The offline signing procedure establishes an air-gapped security boundary between untrusted online networks and private key storage.

```
 [ ONLINE MACHINE ]                      [ SECURE AIR-GAP ]                     [ OFFLINE SIGNER ]
         │                                       │                                       │
 1. Query Nonce Account                          │                                       │
    (getNonce, rent, state)                      │                                       │
         │                                       │                                       │
 2. Assemble Transaction                         │                                       │
    - nonceAdvance (idx 0)                       │                                       │
    - Escrow / Transfer (idx 1)                  │                                       │
    - recentBlockhash = nonce                    │                                       │
         │                                       │                                       │
 3. Serialize Unsigned Message                   │                                       │
    (requireAllSignatures: false)                │                                       │
         │                                       │                                       │
 4. Export Wire Payload                          │                                       │
    (Base64 / QR Code / USB) ───────────────────►│──────────────────────────────────────►│
                                                 │                               5. Inspect Transaction
                                                 │                                  - Verify Nonce Pubkey
                                                 │                                  - Verify Dest & Amount
                                                 │                                  - Check Fee Payer
                                                 │                                       │
                                                 │                               6. Sign with Cold Keys
                                                 │                                  (Nonce Auth + Funder)
                                                 │                                       │
                                                 │                               7. Serialize Signed Tx
                                                 │                                  (requireAllSignatures)
                                                 │                                       │
 8. Import Signed Wire Payload                   │                                       │
    (Base64 String) ◄────────────────────────────│◄──────────────────────────────────────┘
         │
 9. Validate Signatures & Simulate
    (simulateTransaction)
         │
10. Broadcast when Online
    (sendRawTransaction)
         │
11. Confirm on Cluster
```

### Stage 1: Online Preparation
1. Query the on-chain nonce account and extract the stored nonce hash.
2. Assemble the transaction: instruction 0 is `SystemProgram.nonceAdvance`, instruction 1 is the transfer or escrow action.
3. Serialize the partially signed or unsigned transaction message:
   ```typescript
   const serializedMessage = tx.serialize({
     requireAllSignatures: false,
     verifySignatures: false,
   });
   const base64WirePayload = serializedMessage.toString("base64");
   ```
4. Transfer `base64WirePayload` via secure QR-code scanning or an encrypted air-gapped drive.

### Stage 2: Offline Signing
1. The air-gapped host deserializes the wire payload:
   ```typescript
   const tx = Transaction.from(Buffer.from(base64Payload, "base64"));
   ```
2. **Mandatory Inspection Checklist:**
   - Confirm instruction 0 is `SystemProgram.nonceAdvance` for the expected nonce account.
   - Confirm instruction 1 destination address matches the verified venue/merchant.
   - Confirm transfer lamport amount matches the invoice exactly.
   - Confirm fee payer is authorized.
3. Sign using local private keys (hardware wallet or air-gapped keypairs):
   ```typescript
   tx.sign(offlineNonceAuthority, offlineFundingAccount);
   ```
4. Export the fully signed binary payload as base64.

### Stage 3: Online Submission
1. The online machine receives the signed base64 payload and recreates the transaction:
   ```typescript
   const signedTx = Transaction.from(Buffer.from(signedBase64Payload, "base64"));
   ```
2. Validate that all signatures are present and valid:
   ```typescript
   if (!signedTx.verifySignatures()) {
     throw new Error("Invalid or missing transaction signatures");
   }
   ```
3. Submit to the cluster via `connection.sendRawTransaction(signedTx.serialize())`.
4. Monitor confirmation status using WebSocket subscriptions or polling with backoff (`getSignatureStatus`).

---

## F. Serialization Format

Solana transactions utilize a compact binary format defined by the Solana runtime.

### Binary Wire Format
A serialized Solana transaction consists of:
1. **Compact-Array of Signatures:** A length-prefixed vector of 64-byte Ed25519 signatures corresponding to the signers listed in the transaction message header.
2. **Message Payload:**
   - **Header:** 3 bytes designating `numRequiredSignatures`, `numReadonlySignedAccounts`, and `numReadonlyUnsignedAccounts`.
   - **Account Addresses:** Compact-u16 length followed by sequential 32-byte public keys.
   - **Recent Blockhash:** 32-byte hash (holds the durable nonce hash).
   - **Instructions:** Compact-u16 array of compiled instructions containing `programIdIndex`, account indices, and byte data length.

### Legacy vs. Versioned Transactions
- **Legacy Transactions (`Transaction`):** Capped at 1,232 bytes (IPv6 MTU buffer size). Suitable for basic durable nonce transfers and single-escrow settlements.
- **Versioned Transactions (`VersionedTransaction` / `MessageV0`):** Support Address Lookup Tables (ALTs) to compress complex multi-account escrows. When using versioned transactions with durable nonces, `SystemProgram.nonceAdvance` remains instruction 0, and the durable nonce is provided to `compileToV0Message({ recentBlockhash: nonceAccount.nonce })`.

### Safe Wire Transport Encoding
The standard transport encoding for moving serialized byte buffers across machines or air-gapped QR codes is **Base64** or **Hexadecimal**. Base64 is strictly a transport representation; the underlying transaction bytes must never be modified or re-encoded during transit.

---

## G. Error Handling and Recovery

| Symptom / Error Code | Root Cause | Recommended Recovery Action |
| :--- | :--- | :--- |
| **`BlockhashNotFound` or `Transaction simulation failed: Blockhash not found`** | The durable nonce account was already advanced or closed before this transaction reached validators. | **Do not resubmit.** Re-query the nonce account to inspect its current nonce. Reconstruct the transaction with the new nonce, re-sign, and broadcast. |
| **`InstructionError(0, InvalidAccountData)`** | Account at `noncePubkey` is uninitialized or not owned by System Program. | Check account balance and call `SystemProgram.nonceInitialize`. Verify `noncePubkey` matches deployment records. |
| **`InstructionError(0, Custom(0))` / Missing Signature** | Nonce authority did not sign the transaction. | Ensure the keypair matching `nonceAccount.authorizedPubkey` signs the transaction. |
| **`AccountNotFound` on Fee Payer** | The designated fee payer has 0 lamports or is unfunded on-chain. | Fund the fee payer with sufficient SOL to cover base network fees (~5,000 lamports). |
| **`InsufficientFundsForFee`** | Fee payer has lamports, but balance is less than required fee. | Add funds to fee payer wallet before broadcasting. |
| **`InstructionError(1, Custom(x))` (Business Failure)** | Escrow conditions changed (e.g. seat already booked or expired). | The nonce will be consumed if simulation passed and tx landed. Re-evaluate application business logic before rebuilding. |
| **RPC 429 / Rate Limited** | Active RPC node is shedding load. | Fail over to secondary RPC endpoint using `SolanaRpcConnectionPool` exponential backoff with jitter. |
| **Network Timeout During `sendRawTransaction`** | HTTP connection dropped during POST. | Query `connection.getSignatureStatuses([signature])`. If found/confirmed, do not resubmit. If unconfirmed and nonce remains unadvanced, safely resend the same raw bytes. |

### Crucial Recovery Principle: Re-submitting vs. Re-building
- **Same Raw Bytes Retry:** If submission timed out due to network congestion but `connection.getNonce()` proves the nonce has **not** advanced, the exact same signed wire transaction can be safely rebroadcast.
- **Rebuilding Required:** Once the nonce account advances on-chain, the old transaction signature is permanently invalidated. A new transaction must be constructed with the fresh nonce and signed from scratch.

---

## H. Security Considerations

1. **Air-Gapped Key Custody:** Private keys for the nonce authority and funder must never touch an internet-connected device. Always transfer serialized transaction messages to cold storage for signing.
2. **Visual Inspection Before Signing:** The air-gapped signer must inspect and display:
   - Nonce Account Public Key.
   - Recipient Public Key (must match verified merchant/venue address).
   - Transfer Amount (SOL / SPL token units).
   - Fee Payer Address.
3. **Single-Transaction Concurrency:** A durable nonce account can process only one transaction at a time. Attempting to sign two concurrent transactions with the same nonce results in a race where the first consumes the nonce and the second permanently fails. For parallel workflows, allocate distinct nonce accounts.
4. **Authority Separation:** Never use the venue's master treasury or seat escrow PDA as the nonce authority. Use a dedicated, low-privilege operational authority keypair.
5. **Nonce Account Rent Draining Protection:** Nonce accounts must maintain rent exemption. Only the authorized authority can withdraw lamports via `SystemProgram.nonceWithdraw`. Ensure the withdrawal destination is restricted to a multi-sig vault.

---

## I. WorkSphere Integration and Limitations

### Current Repository Status
- **Implemented Components:**
  - `src/lib/payments/solanaPay.ts`: Solana Pay link/QR generation, fee limit validation (`validateRelayFeeLamports`), and RPC connection failover pool (`SolanaRpcConnectionPool`).
  - `src/lib/solana/solanaPayEscrow.ts`: Desk seat escrow lifecycle (reserve, deposit, release, dispute, and refund).
  - `src/hooks/useSolanaSeatEscrow.ts`: React hook managing optimistic seat reservation and cleanup.
- **Unimplemented / Future Integration:**
  - Automated durable nonce account provisioning for digital nomad accounts is **not currently implemented** in runtime code.
  - Native offline QR air-gap serialization in the frontend is **proposed** for future mobile releases.
  - Desk bookings currently use standard recent-blockhash transactions managed via connected browser extensions (Phantom, Solflare) with a 60–90 second validity window.

---

## J. Operational Checklist

### Nonce Account Setup Checklist
- [ ] Nonce account keypair generated securely offline.
- [ ] Rent-exempt balance queried via `getMinimumBalanceForRentExemption(80)`.
- [ ] `createAccount` and `nonceInitialize` combined in initialization transaction.
- [ ] Transaction confirmed on-chain and verified via `getNonce()`.

### Online Preparation Checklist
- [ ] Fresh nonce value retrieved from on-chain nonce account.
- [ ] `SystemProgram.nonceAdvance` placed at instruction index 0.
- [ ] Escrow/payment instruction placed at instruction index 1.
- [ ] `recentBlockhash` set to durable nonce string.
- [ ] `feePayer` assigned.
- [ ] Unsigned wire payload exported as Base64.

### Offline Signing Checklist
- [ ] Base64 payload transferred to air-gapped machine.
- [ ] Transaction deserialized via `Transaction.from()`.
- [ ] Recipient address and transfer lamports verified against invoice.
- [ ] Nonce account and authority verified against known authorized keys.
- [ ] Transaction signed by all required keys.
- [ ] Signed wire payload exported as Base64.

### Submission & Monitoring Checklist
- [ ] Signed payload imported on online machine.
- [ ] Signatures verified via `verifySignatures()`.
- [ ] Transaction broadcast via `sendRawTransaction()`.
- [ ] Confirmation tracked to `'confirmed'` or `'finalized'` commitment.
- [ ] Nonce account verified as advanced on-chain.

---

## K. References

1. **Solana Official Documentation — Durable Nonces:**  
   [https://solana.com/docs/core/transactions/durable-nonces](https://solana.com/docs/core/transactions/durable-nonces)
2. **Solana System Program Nonce Instructions:**  
   [https://docs.rs/solana-program/latest/solana_program/system_instruction/enum.SystemInstruction.html](https://docs.rs/solana-program/latest/solana_program/system_instruction/enum.SystemInstruction.html)
3. **Solana Web3.js SDK Reference (`@solana/web3.js` v1.99.0):**  
   `NonceAccount`, `SystemProgram.nonceAdvance`, `SystemProgram.nonceInitialize`, `SystemProgram.nonceWithdraw`.
4. **Solana CLI Offline Transaction Signing Guide:**  
   [https://solana.com/docs/core/transactions/offline-signing](https://solana.com/docs/core/transactions/offline-signing)
