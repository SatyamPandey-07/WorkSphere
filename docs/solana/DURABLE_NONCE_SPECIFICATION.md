# Solana Durable Nonce Transaction Serialization and Offline Signing Guide

> **Technical Architecture Specification & Operational Reference**  
> **Status:** Proposed Specification / Operational Integration Guide  
> **Target Subsystems:** Solana Settlement (`src/lib/solana/escrowClient.ts`, `src/lib/solana/solanaPayEscrow.ts`, `src/lib/solana/escrowTransactionRetry.ts`)  
> **Scope:** Durable Nonce Account Management, Offline Signing Lifecycle, Hardware Wallet Integration, Versioned vs. Legacy Transaction Serialization, RPC Confirmation Strategies, and Seat Escrow Integration  
> **Related Documentation:** [`docs/solana/ESCROW_SETTLEMENT_RUNBOOK.md`](./ESCROW_SETTLEMENT_RUNBOOK.md), [`docs/solana/SOLANA_ESCROW_REFUND_CRON.md`](./SOLANA_ESCROW_REFUND_CRON.md), and [`docs/solana/OPTIMISTIC_ESCROW_STREAMING.md`](./OPTIMISTIC_ESCROW_STREAMING.md)

---

## 1. Overview and Motivation

In standard Solana transaction processing, every transaction must reference a recent cluster blockhash via its `recentBlockhash` header field.

### Ordinary Recent-Blockhash Transaction Validity Window

On the Solana mainnet cluster, a new block is produced approximately every 400 milliseconds, and blockhashes are tracked in a ring buffer with a 300-slot commitment horizon:
- A recent blockhash remains valid for roughly **150 slots**, which corresponds to approximately **60 to 90 seconds** of real wall-clock time.
- When an ordinary transaction is signed, its signatures commit cryptographically to that specific blockhash.
- If the transaction is not accepted into a block before the blockhash expires, validators reject it with `BlockhashNotFound`.

### The Nomad Disconnection Problem

WorkSphere nomads frequently travel across countries, work in basements, transit through flights, or operate in coworking hubs with intermittent or shielded cellular reception. Under standard blockhash lifecycles:
1. A transaction prepared and signed while online will expire within 60–90 seconds.
2. If a nomad disconnects before broadcasting, the transaction becomes permanently invalid.
3. Cold-storage or air-gapped hardware wallets (e.g., Ledger, Keystone) that require physical QR-code inspection or multi-party review cannot complete multi-signature approvals within a 60-second window.

### The Role of Solana Durable Nonces

A **Durable Nonce** replaces the fast-expiring cluster blockhash with a persistent 32-byte value stored inside an on-chain **Nonce Account** owned by the Solana System Program.

Key characteristics:
- **Persistent Validity:** A transaction constructed with a durable nonce remains valid indefinitely until the nonce account is explicitly advanced on-chain or closed.
- **Single-Use Enforcement:** The transaction must include an instruction to advance the stored nonce as its very first instruction (`SystemProgram.nonceAdvance`). When the transaction executes, the runtime updates the nonce to a fresh cluster blockhash, preventing replay attacks.
- **Air-Gapped & Multi-Sig Friendly:** Allows transactions to be generated on an online server, transferred to an air-gapped machine or hardware wallet, signed at leisure, and held until network connectivity is restored.

### Critical Limitations & Non-Guarantees

A durable nonce is an execution-validity mechanism, **not an economic or state guarantee**:
- **No Balance Guarantee:** A valid nonce transaction will fail at execution time if the fee payer or user vault lacks sufficient lamports when broadcast.
- **No Escrow Invariant Guarantee:** If an escrow's state changes on-chain (e.g., an automatic timeout refund runs or the seat is cancelled), a delayed deposit or release transaction will still fail program logic.
- **Single Thread of Execution per Nonce Account:** Because each successful transaction advances the nonce, a nonce account can only support **one pending transaction at a time**. Parallel offline transactions require distinct nonce accounts.

---

## 2. Durable Nonce Account Initialization

A durable nonce account is a standard Solana account owned by the System Program (`11111111111111111111111111111111`) with a fixed length of 80 bytes (`NONCE_ACCOUNT_LENGTH`).

### Roles and Account Structure

1. **Nonce Account Public Key (`noncePubkey`):** The address where the 32-byte nonce hash, authority pubkey, and fee calculator are stored.
2. **Nonce Authority (`authorizedPubkey`):** The entity permitted to advance, authorize changes to, or withdraw funds from the nonce account.
3. **Payer / Funder:** The account that funds the rent-exempt balance (minimum lamports required for 80 bytes).
4. **System Program:** Owns the account data and enforces nonce advancement invariants.

### Lifecycle of Nonce Account Setup

```
[ Unfunded Address ]
         │
         │  1. SystemProgram.createAccount (allocate 80 bytes, transfer rent)
         ▼
[ Allocated Account ]
         │
         │  2. SystemProgram.nonceInitialize (set authorizedPubkey, write initial blockhash)
         ▼
[ Active Nonce Account ] (State = Initialized, Nonce = RecentBlockhash)
```

### TypeScript Implementation (@solana/web3.js 1.99.x)

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  NONCE_ACCOUNT_LENGTH,
  sendAndConfirmTransaction,
  NonceAccount,
} from "@solana/web3.js";

export interface InitializeNonceAccountResult {
  nonceAccountPubkey: PublicKey;
  initialNonce: string;
  signature: string;
}

/**
 * Creates and initializes a new Durable Nonce Account.
 * Verified against @solana/web3.js v1.99.0 APIs.
 */
export async function createAndInitializeNonceAccount(
  connection: Connection,
  payer: Keypair,
  nonceAuthority: PublicKey,
  nonceAccountKeypair: Keypair = Keypair.generate(),
): Promise<InitializeNonceAccountResult> {
  // 1. Calculate minimum rent exemption for an 80-byte Nonce Account
  const rentExemptLamports =
    await connection.getMinimumBalanceForRentExemption(
      NONCE_ACCOUNT_LENGTH,
      "confirmed",
    );

  const tx = new Transaction();

  // 2. Allocate account space and transfer rent
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: nonceAccountKeypair.publicKey,
      lamports: rentExemptLamports,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SystemProgram.programId,
    }),
  );

  // 3. Initialize the Nonce Account with authority
  tx.add(
    SystemProgram.nonceInitialize({
      noncePubkey: nonceAccountKeypair.publicKey,
      authorizedPubkey: nonceAuthority,
    }),
  );

  // 4. Send and confirm initialization transaction
  const signature = await sendAndConfirmTransaction(
    connection,
    tx,
    [payer, nonceAccountKeypair],
    { commitment: "confirmed" },
  );

  // 5. Read initialized nonce state
  const accountInfo = await connection.getAccountInfo(
    nonceAccountKeypair.publicKey,
    "confirmed",
  );
  if (!accountInfo) {
    throw new Error("Failed to retrieve initialized nonce account");
  }

  const nonceAccount = NonceAccount.fromAccountBuffer(accountInfo.data);

  return {
    nonceAccountPubkey: nonceAccountKeypair.publicKey,
    initialNonce: nonceAccount.nonce,
    signature,
  };
}
```

---

## 3. NonceAdvance Instruction and Transaction Serialization

To use a durable nonce, the transaction must satisfy strict on-chain layout rules:
1. **First Instruction Invariant:** The transaction's first instruction must be `SystemProgram.nonceAdvance`.
2. **Blockhash Field:** The transaction's `recentBlockhash` field must be set to the 32-byte hash stored in the nonce account, **not** the current cluster blockhash.
3. **Signer Requirements:** The nonce authority (`authorizedPubkey`) must sign the transaction to authorize advancing the nonce.

### SystemProgram.nonceAdvance Specification

```typescript
SystemProgram.nonceAdvance({
  noncePubkey: PublicKey,       // Writable, Non-signer
  authorizedPubkey: PublicKey,  // Read-only, Signer
});
```

Under the hood, `@solana/web3.js` constructs an instruction pointing to the System Program with 3 account keys:
- Account 0: `noncePubkey` (Writable: `true`, Signer: `false`)
- Account 1: `SYSVAR_RECENT_BLOCKHASHES_PUBKEY` (`SysvarRecentB1ockHashes11111111111111111111`) (Writable: `false`, Signer: `false`)
- Account 2: `authorizedPubkey` (Writable: `false`, Signer: `true`)

### Legacy vs. Versioned Transaction Construction

`@solana/web3.js` provides first-class support for durable nonces in both Legacy `Transaction` and modern `VersionedTransaction`.

#### Pattern A: Legacy Transaction with `nonceInfo`
```typescript
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type NonceInformation,
  NonceAccount,
} from "@solana/web3.js";

export async function buildLegacyDurableNonceTransaction(
  connection: Connection,
  noncePubkey: PublicKey,
  nonceAuthority: PublicKey,
  feePayer: PublicKey,
  businessInstructions: any[],
): Promise<Transaction> {
  const accountInfo = await connection.getAccountInfo(noncePubkey, "confirmed");
  if (!accountInfo) throw new Error("Nonce account not found");
  const nonceAccount = NonceAccount.fromAccountBuffer(accountInfo.data);

  const nonceInstruction = SystemProgram.nonceAdvance({
    noncePubkey,
    authorizedPubkey: nonceAuthority,
  });

  const nonceInfo: NonceInformation = {
    nonce: nonceAccount.nonce,
    nonceInstruction,
  };

  // Instantiating with nonceInfo configures auto-advance insertion and recentBlockhash binding
  const tx = new Transaction({
    feePayer,
    nonceInfo,
  });

  // Add business instructions (nonceInstruction is prepended automatically)
  tx.add(...businessInstructions);

  return tx;
}
```

#### Pattern B: Versioned Transaction with `TransactionMessage`
```typescript
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  NonceAccount,
} from "@solana/web3.js";

export async function buildVersionedDurableNonceTransaction(
  connection: Connection,
  noncePubkey: PublicKey,
  nonceAuthority: PublicKey,
  feePayer: PublicKey,
  businessInstructions: any[],
): Promise<VersionedTransaction> {
  const accountInfo = await connection.getAccountInfo(noncePubkey, "confirmed");
  if (!accountInfo) throw new Error("Nonce account not found");
  const nonceAccount = NonceAccount.fromAccountBuffer(accountInfo.data);

  // In Versioned Transactions, nonceAdvance MUST be explicitly placed at index 0
  const instructions = [
    SystemProgram.nonceAdvance({
      noncePubkey,
      authorizedPubkey: nonceAuthority,
    }),
    ...businessInstructions,
  ];

  const messageV0 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: nonceAccount.nonce, // Bound to stored nonce
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}
```

---

## 4. Offline Hardware-Wallet Signing Lifecycle

The offline signing workflow isolates private keys entirely on an air-gapped device or hardware wallet while the connected client prepares and broadcasts the transaction.

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                           1. Online Preparation Stage                          │
│ - Connects to Solana RPC pool (`Connection`).                                 │
│ - Fetches current `NonceAccount` state via `getAccountInfo`.                   │
│ - Derives escrow accounts, calculates priority fees, and builds instructions.  │
│ - Binds `recentBlockhash` = `nonceAccount.nonce`.                             │
│ - Serializes unsigned transaction to base64 buffer.                            │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │ (Air-gapped transfer via QR/USB/File)
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                        2. Offline Signing Stage (Hardware)                     │
│ - Hardware wallet deserializes transaction message bytes.                      │
│ - Device display renders: recipient, amounts, and `nonceAdvance` instruction.  │
│ - Nomad physically reviews and confirms transaction on device screen.          │
│ - Hardware wallet cryptographically signs the message using Ed25519.           │
│ - Exports signed transaction wire bytes.                                       │
└───────────────────────────────────────┬────────────────────────────────────────┘
                                        │ (Return transfer)
                                        ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                          3. Verification & Broadcast                           │
│ - Client parses signed wire bytes with `Transaction.from(buffer)`.             │
│ - Validates Ed25519 signatures locally without network calls.                  │
│ - Broadcasts via `connection.sendRawTransaction(rawBytes)`.                    │
│ - Monitors execution and tracks commitment: `confirmed` -> `finalized`.        │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Complete Code Pattern: Preparation, Offline Signing, and Verification

```typescript
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  NonceAccount,
} from "@solana/web3.js";

/**
 * Step 1: Online Preparation
 * Generates base64-encoded unsigned transaction payload.
 */
export async function prepareOfflineEscrowTransaction(
  connection: Connection,
  noncePubkey: PublicKey,
  nonceAuthority: PublicKey,
  depositorPubkey: PublicKey,
  depositInstruction: any,
): Promise<{ serializedUnsignedTx: string; durableNonce: string }> {
  const accountInfo = await connection.getAccountInfo(noncePubkey, "confirmed");
  if (!accountInfo) throw new Error("Nonce account not found");
  const nonceAccount = NonceAccount.fromAccountBuffer(accountInfo.data);

  const tx = new Transaction({
    feePayer: depositorPubkey,
    nonceInfo: {
      nonce: nonceAccount.nonce,
      nonceInstruction: SystemProgram.nonceAdvance({
        noncePubkey,
        authorizedPubkey: nonceAuthority,
      }),
    },
  });

  tx.add(depositInstruction);

  // Serialize message without requiring signatures
  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString("base64");

  return { serializedUnsignedTx: serialized, durableNonce: nonceAccount.nonce };
}

/**
 * Step 2: Offline Hardware-Wallet Signature Application
 * Illustrative signing adapter for an air-gapped signer.
 */
export function applyOfflineSignature(
  serializedUnsignedTxBase64: string,
  signerKeypair: Keypair, // Represents hardware device or cold key
): string {
  const txBytes = Buffer.from(serializedUnsignedTxBase64, "base64");
  const tx = Transaction.from(txBytes);

  // Hardware wallet signs the compiled message bytes
  tx.partialSign(signerKeypair);

  return tx.serialize().toString("base64");
}

/**
 * Step 3: Broadcast and Confirmation
 */
export async function broadcastSignedDurableNonceTransaction(
  connection: Connection,
  signedTxBase64: string,
): Promise<string> {
  const rawBytes = Buffer.from(signedTxBase64, "base64");
  const tx = Transaction.from(rawBytes);

  // 1. Verify signatures locally before network broadcast
  if (!tx.verifySignatures()) {
    throw new Error("Transaction signature verification failed");
  }

  // 2. Broadcast raw wire bytes
  const signature = await connection.sendRawTransaction(rawBytes, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });

  return signature;
}
```

---

## 5. Durable Nonce State Machine and Lifecycle

A durable nonce account transitions through discrete states:

```
[Unallocated] 
      │
      │ SystemProgram.createAccount
      ▼
[Allocated (80 bytes)]
      │
      │ SystemProgram.nonceInitialize
      ▼
[Initialized (State=1)] ◄────────────────────────┐
      │                                         │
      │ 1. Transaction Prepared                 │
      │    (recentBlockhash = NonceValue_N)     │
      │ 2. Broadcast to Cluster                 │
      │                                         │ Nonce Advanced
      ▼                                         │ (State=1, NonceValue=N+1)
[Processing NonceAdvance] ──────────────────────┘
      │
      │ (If Nonce Account closed via nonceWithdraw)
      ▼
[Closed / Deallocated]
```

### Anomaly and Failure Analysis

| Scenario | What Happens | System Impact & Handling |
|---|---|---|
| **Stale Nonce (Advanced by another TX)** | Cluster rejects with `InstructionError: 0, Custom: 0` | The offline transaction is dead. The client must re-fetch the new nonce and re-sign the transaction. |
| **Broadcast More Than Once** | First execution advances nonce; duplicate fails | Solana rejects replay with `AlreadyProcessed` or `BlockhashNotFound`. Replay cannot double-spend. |
| **Signed But Never Broadcast** | Nonce remains frozen at NonceValue_N | Nonce account remains valid for that transaction indefinitely until manually advanced. |
| **Two Offline TXs share one Nonce** | Race condition: the first to land advances the nonce | The second transaction will fail permanently. **Never share nonce accounts across concurrent workflows.** |
| **Cluster Rejection (e.g. Escrow assertion fails)** | `nonceAdvance` still succeeds if valid | **Critical Solana Rule:** The transaction fee is paid and the nonce advances even if later instructions fail. |

---

## 6. Complete Sequence Diagram

```mermaid
sequenceDiagram
  autonumber
  actor Nomad as Nomad User
  participant App as WorkSphere Client
  participant RPC as Solana RPC Pool
  participant HW as Offline Signer / HW Wallet
  participant Chain as Solana Cluster

  Note over App,RPC: Phase 1: Online Nonce & Escrow Preparation
  App->>RPC: getAccountInfo(noncePubkey, "confirmed")
  RPC-->>App: NonceAccount (nonce = "HashABC123", authority)
  App->>App: Build SystemProgram.nonceAdvance(noncePubkey, auth)
  App->>App: Build Escrow Instruction (deposit_sol / deposit_usdc)
  App->>App: Compile Message (recentBlockhash = "HashABC123")
  App->>App: Serialize Unsigned Wire Bytes

  Note over App,HW: Phase 2: Offline Air-Gapped Signing
  App->>Nomad: Display QR Code / Wire Transfer
  Nomad->>HW: Load Unsigned Transaction Message
  HW->>Nomad: Display Details (Advance Nonce + Escrow Amount)
  Nomad->>HW: Physically Confirm on Device
  HW->>HW: Sign Message with Ed25519 Private Key
  HW-->>App: Return Signed Wire Payload

  Note over App,Chain: Phase 3: Delayed Broadcast & Settlement
  Nomad->>App: Reconnect to Internet
  App->>App: Verify Ed25519 Signatures Locally
  App->>RPC: sendRawTransaction(signedWireBytes)
  
  alt Stale Nonce Detected
    RPC-->>App: Transaction Error (BlockhashNotFound / NonceStale)
    App->>Nomad: Notify: Nonce advanced by other tx; re-signing required
  else Nonce Valid
    RPC->>Chain: Submit to Validator Leader
    Chain->>Chain: Execute Instruction 0: Advance Nonce to "HashXYZ789"
    Chain->>Chain: Execute Instruction 1: Escrow Deposit to PDA
    Chain-->>RPC: Signature Status: confirmed
    RPC-->>App: WebSocket onSignatureWithOptions ("confirmed")
    App->>App: Update Seat State: confirmed
    Chain-->>RPC: Root Commitment: finalized
    RPC-->>App: Signature Status: finalized
    App->>App: Update Seat State: finalized
  end
```

---

## 7. RPC Commitment and Confirmation Guidelines

Choosing the proper RPC commitment is critical for durable nonce correctness:

### Commitment Levels in Nonce Workflows

| Level | Latency | Rollback Risk | Appropriate Durable Nonce Usage |
|---|---|---|---|
| `processed` | ~400 ms | High (fork reorg possible) | **Never use for reading nonce accounts.** An unconfirmed nonce read could lead to building transactions on an orphaned fork. |
| `confirmed` | ~1–2 sec | Extremely Low (< 0.01%) | **Recommended for Nonce Fetching & Preparation.** Represents supermajority gossip vote; fast enough for interactive UI preparation. |
| `finalized` | ~12–30 sec | Zero (Rooted) | **Mandatory for High-Value Escrow Settlement.** Guarantees the deposit cannot be rolled back before issuing physical access keys. |

### Why `lastValidBlockHeight` Must NOT Be Used

In standard blockhash transactions, callers supply `lastValidBlockHeight` to `connection.confirmTransaction()`:
```typescript
// ❌ WRONG for Durable Nonce transactions
await connection.confirmTransaction({
  blockhash,
  lastValidBlockHeight, // Nonce transactions do not expire at block height!
  signature,
});
```

Because durable nonce transactions are not bounded by block height, passing `lastValidBlockHeight` will prematurely report a timeout while the nonce remains completely valid.

### Correct Nonce Confirmation: Polling `getSignatureStatuses`

WorkSphere's `src/lib/solana/solanaPayEscrow.ts` implements this pattern:
1. Poll `connection.getSignatureStatuses([signature])`.
2. Inspect `confirmationStatus` until it reaches `'confirmed'` or `'finalized'`.
3. Check `err` for transaction execution errors.

---

## 8. WorkSphere Seat Escrow Integration

### Existing Architecture vs. Durable Nonce Integration

| Component | Existing WorkSphere Architecture | Proposed Durable Nonce Workflow | Status |
|---|---|---|---|
| **Transaction Header** | `recentBlockhash` fetched via `connection.getLatestBlockhash()` | `recentBlockhash` fetched from on-chain `NonceAccount` | **Proposed Enhancement** |
| **Instruction 0** | Optional `ComputeBudgetProgram.setComputeUnitLimit` | `SystemProgram.nonceAdvance` (Mandatory at index 0) | **Proposed Enhancement** |
| **Instruction 1+** | `deposit_sol` or `deposit_usdc` to Escrow PDA | Unchanged: PDA derivation and program instructions | **Existing Production** |
| **Signing Mode** | Immediate browser wallet popup (`window.solana.signTransaction`) | Air-gapped QR / hardware-wallet export and delayed signature | **Proposed Architecture** |
| **Seat State Tracking** | `SolanaPayEscrowManager` (`provisionally_reserved` -> `confirmed` -> `finalized`) | Same state machine; extended timeout horizon | **Compatible as-is** |

### Mapping to `src/lib/solana/escrowClient.ts`

In `escrowClient.ts`:
- PDA derivation (`deriveEscrowPDA(bookingId)`) remains completely identical:
  $$\text{PDA} = \text{findProgramAddress}([\text{"worksphere\_escrow"}, \; \text{bookingId}], \; \text{programId})$$
- When preparing an offline escrow deposit:
  1. The server or client allocates a dedicated nonce account for the nomad's session.
  2. The deposit instruction is built via `buildDepositInstruction()`.
  3. The transaction is packaged with `nonceInfo` pointing to the nomad's nonce account.
  4. The serialized unsigned transaction is saved in local IndexedDB (`offline_escrow_queue`).
  5. Upon returning online, the background `OfflineMutationQueue` dispatches the pre-signed transaction to the RPC pool.

---

## 9. Failure Handling and Security

### Threat Model & Protections

1. **Stale Nonce Race Condition:**  
   If an administrator or automated script inadvertently advances a nonce account while an offline transaction is signed, the transaction becomes permanently invalid. WorkSphere must enforce that each nonce account is strictly 1:1 mapped to a specific pending booking ID.
2. **Unauthorized Nonce Advancement:**  
   The nonce authority private key must never be transmitted over HTTP or stored in client-side local storage. For user-managed transactions, the nomad's wallet public key serves as the nonce authority.
3. **Escrow Expiry During Offline Periods:**  
   If a user remains offline for 48 hours with a signed deposit transaction, the booking slot might have expired in the database. When the client reconnects, it must check `GET /api/bookings/:id/status` before broadcasting the raw transaction to avoid depositing funds into an expired reservation.
4. **Transaction Fee Deductions on Execution Failure:**  
   Because Solana runtime advances the nonce and charges the fee payer even if downstream program instructions fail, client-side simulation (`connection.simulateTransaction`) should always be executed prior to broadcast.

---

## 10. References

1. **Solana Durable Nonce Official Documentation:**  
   Solana Labs. *Durable Nonces Guide*. [https://solana.com/docs/core/transactions/durable-nonces](https://solana.com/docs/core/transactions/durable-nonces)
2. **Solana System Program Source:**  
   Solana Foundation. *System Program Nonce Instruction Layouts*. [Solana GitHub](https://github.com/solana-labs/solana)
3. **`@solana/web3.js` SDK Documentation:**  
   Solana Labs. *Class NonceAccount and TransactionNonceCtor*. [Solana Web3.js API](https://solana-labs.github.io/solana-web3.js/)
4. **WorkSphere Architecture References:**  
   - [`docs/solana/ESCROW_SETTLEMENT_RUNBOOK.md`](./ESCROW_SETTLEMENT_RUNBOOK.md)
   - [`docs/solana/SOLANA_ESCROW_REFUND_CRON.md`](./SOLANA_ESCROW_REFUND_CRON.md)
   - [`src/lib/solana/solanaPayEscrow.ts`](../../src/lib/solana/solanaPayEscrow.ts)
   - [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts)
