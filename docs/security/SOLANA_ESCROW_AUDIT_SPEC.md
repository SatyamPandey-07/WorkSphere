# Confidential Solana Smart Escrow Security Audit Specification

**Document status:** Audit specification

**Issue:** WorkSphere #7939

**Primary implementation:** [`src/lib/solana/escrowClient.ts`](../../src/lib/solana/escrowClient.ts)

**On-chain implementation:** [`programs/worksphere-escrow/src/lib.rs`](../../programs/worksphere-escrow/src/lib.rs)
**Related client and operational sources:**

- [`src/lib/solana/solanaPayEscrow.ts`](../../src/lib/solana/solanaPayEscrow.ts)
- [`src/app/api/pay/solana/route.ts`](../../src/app/api/pay/solana/route.ts)
- [`src/app/api/cron/escrow-refund/route.ts`](../../src/app/api/cron/escrow-refund/route.ts)
- [`src/workers/escrowMonitorWorker.ts`](../../src/workers/escrowMonitorWorker.ts)
- [`prisma/schema.prisma`](../../prisma/schema.prisma)
- [`src/__tests__/solana/escrow.test.ts`](../../src/__tests__/solana/escrow.test.ts)
- [`src/__tests__/lib/solana/escrowRefundSubmission.test.ts`](../../src/__tests__/lib/solana/escrowRefundSubmission.test.ts)

## 1. Overview

### 1.1 Purpose and scope

This specification defines the PDA and escrow transition properties that an external auditor must verify for WorkSphere's Solana escrow implementation. It covers:

- the client-derived escrow PDA;
- the local Anchor escrow program's `deposit_sol`, `deposit_usdc`, `release`, and `refund` instructions;
- the client-side deposit, verification, release, refund, and confirmation flows;
- the database-backed refund cron and its confirmation reconciliation; and
- the trust and failure boundaries between wallet, RPC, API, database, authority key, and on-chain program.

The scope is limited to repository-visible behavior. It does not assert that a program deployed outside this repository matches the local source or the deployed `NEXT_PUBLIC_ESCROW_PROGRAM_ID`.

### 1.2 Security boundaries

The repository identifies the following trust boundaries:

| Boundary                         | Source of truth                                            | Untrusted or partially trusted party                     |
| -------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Wallet to RPC                    | Wallet signature and recent blockhash                      | Wallet UX, RPC response, browser code                    |
| Client to API                    | Authenticated booking ownership and server-ledger state    | Submitted wallet and booking identifiers                 |
| API to on-chain program          | Anchor account constraints and program instructions        | API, RPC, serialized transaction metadata                |
| Authority to program             | `authority: Signer` and stored `escrow.authority` equality | Platform authority key, refund cron, API                 |
| Off-chain evidence to settlement | Prisma booking/check-in/closure records                    | Client GPS and client-submitted evidence                 |
| Database to on-chain state       | Confirmed/finalized transaction and on-chain account state | Database status, optimistic local state, RPC-only status |

### 1.3 Explicit assumptions and limitations

- The actual Solana Anchor program source is present at `programs/worksphere-escrow/src/lib.rs` and declares the program ID `WsEscrow11111111111111111111111111111111111`.
- The client defaults to the System Program ID (`11111111111111111111111111111111`) if `NEXT_PUBLIC_ESCROW_PROGRAM_ID` is absent. This is a placeholder, not evidence that the declared Anchor program is deployed.
- The deployed program ID must be independently verified. A matching PDA derivation or matching source seed does not prove that the configured account contains this program.
- Solana runtime, transaction atomicity, Anchor `#[account]` constraints, SPL Token behavior, and RPC infrastructure are outside repository control.
- The off-chain verification functions consult Prisma server records, but an external audit must verify that those records are created only from trusted server-side evidence.
- This document does not establish that any deployed program has been upgraded, built, or instantiated with the checked-in source.
- Solana clock values and RPC confirmation statuses are inputs to a safety design, not independently trusted oracles.

## 2. PDA Authority Derivation

### 2.1 Exact PDA seeds

Both the Anchor program and the TypeScript client derive the escrow account with the same logical seeds:

```text
seed[0] = ASCII/UTF-8 bytes of "worksphere_escrow"
seed[1] = UTF-8 bytes of bookingId
```

The ordering is exact: the domain prefix is first and the booking ID is second. The bump is added by Anchor or by `PublicKey.findProgramAddressSync` and is not included in the client seed array.

The TypeScript implementation is:

```typescript
PublicKey.findProgramAddressSync(
  [Buffer.from("worksphere_escrow"), Buffer.from(bookingId)],
  programId,
);
```

The Rust account contexts use:

```rust
seeds = [ESCROW_SEED_PREFIX, booking_id.as_bytes()]
bump
```

with `ESCROW_SEED_PREFIX = b"worksphere_escrow"`.

### 2.2 Seed encoding and ordering

- `"worksphere_escrow"` is encoded as raw ASCII bytes.
- `bookingId` is encoded as UTF-8 in the client and as the Rust `String` byte representation on-chain.
- No additional tenant, venue, depositor, or currency seed is present.
- No hash or canonicalized booking identifier is used as a seed.
- The Rust account stores the original `booking_id` as a `String`, with a source-side maximum of 64 bytes checked by `require!(booking_id.len() <= 64)`.

Solana PDA APIs require each seed to be at most 32 bytes. Although the on-chain instruction validates 64 characters/bytes, seed[1] can therefore exceed the PDA seed limit for booking IDs longer than 32 UTF-8 bytes. This is a verified implementation risk, not a successful known PDA derivation guarantee.

### 2.3 Program ID

The local program declares:

```text
WsEscrow11111111111111111111111111111111111
```

The client accepts `NEXT_PUBLIC_ESCROW_PROGRAM_ID` through `ESCROW_PROGRAM_ID`; without it, it uses the System Program ID:

```text
11111111111111111111111111111111
```

The PDA is derived against the supplied or configured program ID. An external auditor must verify that:

1. the configured environment ID equals the deployed local program ID;
2. the deployed account owner is the matching loader/executable account;
3. release/refund and deposit builders consistently use the same ID; and
4. no legacy or placeholder program ID is accepted for escrow construction.

### 2.4 Bump derivation and ownership

The client calls `PublicKey.findProgramAddressSync` and retains the canonical bump returned by the SDK. On deposit, Anchor derives a canonical bump and stores `ctx.bumps.escrow_account` in `EscrowAccount.bump`.

On USDC release/refund, the program reconstructs the PDA signer with:

```rust
seeds = [
    ESCROW_SEED_PREFIX,
    escrow.booking_id.as_bytes(),
    &[escrow.bump],
]
```

Anchor's seeded account constraints also use the canonical bump for the escrow account. The PDA owner is the escrow program; the SOL vault is the escrow account itself. The USDC vault is a separate SPL token account supplied in the instruction contexts.

### 2.5 Authority ownership

The deposit instruction stores caller-supplied `recipient` and `authority` values in `EscrowAccount`. The client does not pass or initialize these fields in the currently implemented `buildSolDepositTransaction` and `buildUsdcDepositTransaction` flows, because those flows do not construct the Anchor deposit instructions.

For settlement:

- `release.authority` is a required signer.
- `refund.authority` is a required signer.
- The program verifies `authority.key() == escrow.authority`.
- `release.recipient` must equal `escrow.recipient`.
- `refund.depositor` must equal `escrow.depositor`.

The deposit contexts do not mark `recipient` or `authority` as signers and do not constrain them to a configured platform public key. This is a verified on-chain account-binding gap at deposit initialization.

### 2.6 Vault derivation

For SOL, the vault is the seeded `escrow_account`, derived from `[b"worksphere_escrow", bookingId_bytes]`. For USDC, the client derives an associated token account for the USDC mint with the escrow PDA as owner, but the on-chain USDC instruction contexts do not prove an ATA or canonical mint binding.

The USDC associated-token derivation in the client is:

```typescript
[escrowPda.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()];
```

under the Associated Token Program. This is the intended client derivation. It is not enforced as the sole vault by the local settlement account constraints.

### 2.7 Collision and substitution considerations

- A booking ID that is reused across the platform maps to the same PDA and the same `EscrowAccount` under the same program ID.
- The raw booking ID has no domain-separated hash and no separate tenant or venue seed.
- Multiple currencies and escrow instances for the same booking share one logical PDA namespace, subject to one `init` account.
- A 33-64 byte booking ID is accepted by the Rust 64-byte account check but may not be usable for PDA derivation due to the Solana per-seed 32-byte limit.
- A different program ID produces a different PDA.
- At settlement, the release/refund account `escrow_account` is verified through its seeds and stored bump, but caller-supplied SOL recipient/depositor accounts are checked only by equality.
- USDC release/refund vault and destination token accounts are optional and unconstrained by mint, owner, ATA derivation, or expected authority.
- `buildReleaseTransaction` derives its reported vault with the default `ESCROW_PROGRAM_ID` rather than an explicitly supplied `programId`; `createReleaseInstruction` has the same default derivation. `buildRefundTransaction` also derives its reported vault with the default, while `createRefundInstruction` derives with the explicit program ID. These inconsistent derivations can return or target a PDA under the wrong program ID.

## 3. Escrow State Model

### 3.1 Verified state variables

Let:

- `booking_id` be the escrow's stored, on-chain booking identifier.
- `D` be `EscrowAccount.amount` at deposit.
- `C` be `EscrowAccount.currency`, either `SOL` or `USDC`.
- `dep` be `EscrowAccount.depositor`.
- `rec` be `EscrowAccount.recipient`.
- `auth` be `EscrowAccount.authority`.
- `S` be `EscrowAccount.state`, with `Active`, `Released`, or `Refunded`.
- `R` be the amount transferred by a successful release.
- `F` be the amount transferred by a successful refund.
- `B` be the remaining implementation-accounted escrow amount.

The local implementation initializes:

```text
D > 0
S = Active
R = 0
F = 0
B = D
```

On a successful release:

```text
S = Released
R = D
F = 0
B = 0
```

On a successful refund:

```text
S = Refunded
R = 0
F = D
B = 0
```

The implementation does not close escrow accounts after settlement. `B` here is the logical `EscrowAccount.amount` accounting view, not a direct claim about the lamport balance of the account or future rent/fee behavior.

For a non-negative deposit of principal `D`, conservation must satisfy:

```text
D = R + F + B
R >= 0
F >= 0
B >= 0
R > 0 implies F = 0
F > 0 implies R = 0
```

The checked-in program has no separate `R`, `F`, or `B` fields. These are audit-state variables derived from the single terminal state and the stored amount. For an active escrow, `R=F=0` and `B=D`; for release, `R=D`, `F=0`, and `B=0`; for refund, `R=0`, `F=D`, and `B=0`. This representation assumes exactly one successful principal transfer and requires verification against actual lamport/token balances at the deployed runtime.

### 3.2 Implemented on-chain invariants

The following are directly visible in the local program:

1. **Positive deposit amount:** deposit instructions require `amount > 0`.
2. **Booking identifier bound:** every deposit initializes a PDA under `booking_id`; release/refund require `escrow.booking_id == instruction booking_id`.
3. **Active-only settlement:** release/refund require `EscrowState::Active`.
4. **Stored recipient binding:** release requires the supplied recipient public key to equal `escrow.recipient`.
5. **Stored depositor binding:** refund requires the supplied depositor public key to equal `escrow.depositor`.
6. **Stored authority binding:** release/refund require the supplied authority signer public key to equal `escrow.authority`.
7. **Terminal state transition:** successful release sets `Released`; successful refund sets `Refunded`.
8. **Mutually exclusive terminal states:** the account enum has only `Active`, `Released`, and `Refunded`, and settlement requires `Active`.

### 3.3 Proposed audit requirements

These properties are recommended or partially implemented, not guaranteed by the checked-in source alone:

- no unauthorized fund release;
- no unauthorized refund;
- no duplicate settlement;
- conservation of escrowed principal;
- correct deposit account initialization and exact value;
- canonical mint and vault ownership for USDC;
- a valid off-chain release/refund evidence record;
- no settlement during an unresolved dispute; and
- no settlement outside a verified deadline or cancellation policy.

There is no dispute state or dispute instruction in the local Anchor program or client. Cancellation is represented primarily by off-chain booking status and, for expired holds, by database state.

### 3.4 Repository-visible security gaps

The following findings are verified against source and must remain in the scope of an external audit:

1. **Deposit transactions are disconnected from the Anchor deposit instructions.** `buildSolDepositTransaction` adds a System transfer and an arbitrary instruction addressed to the configured program ID; `buildUsdcDepositTransaction` adds an SPL transfer and an arbitrary instruction. Neither invokes `deposit_sol` or `deposit_usdc`, so neither initializes `EscrowAccount.amount`, `state`, depositor, recipient, or authority as shown in the Anchor program.
2. **Deposit verification is incomplete.** `verifyDeposit` compares an SOL vault lamport delta for SOL and only checks that the expected USDC vault appears in account keys for USDC. It does not verify the exact USDC transfer instruction, mint, source ATA, destination ATA, or payer-paid amount.
3. **Settlement instruction account lists do not match the Anchor contexts.** `createReleaseInstruction` and `createRefundInstruction` provide four account keys, while the local Anchor contexts include escrow, authority, recipient/depositor, optional USDC vault, optional USDC destination, optional token program, and system program. The hand-built lists also include no canonical USDC accounts.
4. **Custom-program release derivation is inconsistent.** `buildReleaseTransaction` derives the returned vault using `ESCROW_PROGRAM_ID` even when `params.programId` is supplied; `createReleaseInstruction` itself also ignores `params.programId` for its PDA derivation. `buildRefundTransaction` similarly derives the returned vault without `params.programId`, while `createRefundInstruction` uses the explicit program ID.
5. **The generic release/refund executors do not broadcast.** `releaseEscrow` and `refundEscrow` create an unsigned serialized transaction, record process-local state, and return the serialized transaction as `signature`. They do not sign, send, or confirm a settlement.
6. **Authority and destination fallbacks are unsafe defaults.** In the pay API, `ESCROW_AUTHORITY_WALLET` may be absent, so it falls back to the authenticated Clerk `userId`; release defaults an absent recipient to that authority value and refund defaults an absent depositor to it. A Clerk ID is not a Solana public key and is not evidence of escrow authority or depositor/recipient ownership.
7. **Check-in evidence is not bound by booking.** `verifyCheckInForBooking` finds an active check-in by user and venue, without matching booking ID, seat, date/time, or a booking-specific evidence key.
8. **Operator cancellation is not recognized as closure.** `verifyVenueClosureForBooking` recognizes only `CANCELLED`; it does not recognize the `CANCELLED_BY_OPERATOR` booking enum even though that status exists in Prisma.
9. **Disputes have no implementation.** Neither the local Anchor program nor the Solana client exposes dispute initiation/resolution states or instructions.

## 4. State Transition Matrix

| Transition                 | Preconditions                                                                                                                                                                                                                                            | Operation                                                                                                                                     | Postconditions                                                                                                                                 | Invariant checks                                                                                                                                                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fund deposit: SOL          | Payer is signer; PDA is initialized; `amount > 0`; booking ID length <=64 source-side check; Solana seed length also <=32                                                                                                                                | Anchor `deposit_sol` receives payer, recipient, authority, system program; transfers lamports from depositor to escrow PDA                    | `S=Active`, `D=amount`, `C=Sol`, depositor/recipient/authority stored, `created_at` set                                                        | Verify exact payer transfer, exact destination PDA, initialized account, and no duplicate deposit. The current client builder instead performs a System transfer plus a memo-like instruction, not an Anchor `deposit_sol` instruction.           |
| Fund deposit: USDC         | Payer is signer; PDA is initialized; `amount > 0`; booking ID constraints pass; payer and vault token accounts exist                                                                                                                                     | Anchor `deposit_usdc` transfers SPL tokens into `vault_token_account`; stores depositor/recipient/authority and amount                        | `S=Active`, `D=amount`, `C=Usdc`, depositor/recipient/authority stored                                                                         | Auditor must verify canonical USDC mint, payer ATA, vault ATA/owner, exact transfer, and no duplicate initialization. The current client builder performs SPL transfer and an arbitrary program instruction, not the verified Anchor instruction. |
| Dispute initiation         | Not implemented in on-chain or client state model                                                                                                                                                                                                        | No Anchor instruction or enum state exists                                                                                                    | No transition                                                                                                                                  | Out of scope/on-chain state unverified                                                                                                                                                                                                            |
| Dispute resolution         | Not implemented in on-chain or client state model                                                                                                                                                                                                        | No authority or resolution instruction exists                                                                                                 | No transition                                                                                                                                  | Out of scope/on-chain state unverified                                                                                                                                                                                                            |
| Cancellation               | The API checks server-side booking status and cancellation evidence; this repository defines both `CANCELLED` and `CANCELLED_BY_OPERATOR`, but `verifyVenueClosureForBooking` recognizes only `CANCELLED` and does not recognize `CANCELLED_BY_OPERATOR` | API may request a refund or the refund cron may settle an expired hold; no single on-chain cancellation instruction exists                    | On success, on-chain `S=Refunded`, `F=D`, `B=0`; the DB may move `PENDING -> REFUND_PENDING -> REFUNDED`                                       | Verify cancellation is authoritative, not client-submitted, and has no concurrent release. The database and on-chain states are independent. The operator-cancellation status is an identified verification gap.                                  |
| Disputed/cancelled release | No dispute state exists on-chain                                                                                                                                                                                                                         | Local program would allow active escrow release if the authority signer and recipient match                                                   | If no external policy gate, `S=Released`                                                                                                       | Proposed invariant not implemented: unresolved dispute must block release                                                                                                                                                                         |
| Release                    | Escrow `S=Active`; instruction booking ID matches; authority signer equals stored authority; recipient equals stored recipient                                                                                                                           | Anchor `release` writes check-in timestamp and sets `S=Released`; SOL transfers to recipient or USDC CPI transfers to recipient token account | `S=Released`, `R=D`, `F=0`, `B=0`                                                                                                              | Verify state before transfer, authority, recipient, token accounts, no second settlement, and exact amount                                                                                                                                        |
| Automatic release          | No repository function implements a fully signed/broadcast release worker                                                                                                                                                                                | `releaseEscrow` only constructs an unsigned serialized transaction and records an in-memory `RELEASED` state                                  | Function claims `executed=true` even though it does not broadcast or wait for confirmation                                                     | Not verified as an on-chain automatic release                                                                                                                                                                                                     |
| Refund                     | Escrow `S=Active`; instruction booking ID matches; authority signer equals stored authority; depositor equals stored depositor                                                                                                                           | Anchor `refund` writes closure timestamp and sets `S=Refunded`; SOL or USDC is transferred to depositor                                       | `S=Refunded`, `R=0`, `F=D`, `B=0`                                                                                                              | Verify authority, depositor, closure evidence, exact amount, state, and no second settlement                                                                                                                                                      |
| Automatic refund           | DB hold has expired and passes atomic claim; authority key is configured; program ID is deployed; signature persists before broadcast                                                                                                                    | Cron calls `submitEscrowRefundTransaction`, signs locally, broadcasts with preflight, then polls signature status                             | `REFUND_PENDING -> REFUNDED` only after confirmed/finalized status; on explicit failure or stale unsigned claim, code moves to fallback states | Verify signature persistence, fencing, confirmed on-chain failure handling, exact PDA/depositor, and no concurrent refund                                                                                                                         |

## 5. Threat Model

### 5.A Re-entrancy

**External CPI interactions**

- SOL release/refund use direct lamport balance mutation rather than a user program CPI.
- USDC deposit and settlement use CPI to the SPL Token program.
- The local release/refund state is mutated before the USDC CPI transfer. Solana's transaction/runtime should revert state changes if CPI or the instruction fails.
- SPL Token's implementation and destination account behavior must be validated independently.

**State mutation ordering**

- Anchor checks `S=Active`, booking ID, signer equality, and recipient/depositor equality before mutation.
- Release/refund write the settlement timestamp and terminal state before lamports or SPL CPI.
- The USDC settlement state mutation is in the escrow account and will participate in transaction atomicity.

**Duplicate settlement**

- A second release/refund in the same transaction or after the first successful transaction sees `S != Active` and returns `EscrowNotActive`.
- If a settlement transaction is dropped or unconfirmed, a repeat with the same signature or another valid signature is not fully deduplicated solely by the on-chain escrow state until the first one lands.
- The refund cron persists a signed signature before broadcast and reconciles status, reducing worker-level duplicates.
- The generic in-memory `escrowStateLedger` is process-local and is not an authoritative reentrancy or replay mechanism.
- Hand-built settlement instructions are also incomplete for the local Anchor account contexts: they do not include canonical USDC vault/destination/token-program accounts and may use the wrong program-specific PDA.

**Account locking and atomicity**

- Solana transaction instructions execute atomically. A CPI failure should roll back prior mutations within the transaction.
- Auditors should test state and balance changes in committed and reverted transactions.
- The database refund lifecycle can diverge from on-chain state during crashes, RPC outages, or broadcast ambiguity.

**Checks-effects-interactions**

- On-chain checks precede state mutation.
- The USDC effect is state mutation followed by external token CPI, so transaction atomicity is essential.
- The off-chain refund code should use persisted signatures and confirmed status before marking terminal DB state.

### 5.B Signer spoofing

**Required signer accounts**

- Deposit `depositor` is a signer.
- Release/refund `authority` is a signer.
- The client refund submission signs with `SOLANA_ESCROW_AUTHORITY_SECRET_KEY`.
- The escrow PDA is not an external signer for SOL lamport movement. It is the owner of the SOL account, and for USDC CPI it signs via the stored bump and seeds.

**Authority verification**

- The program correctly requires the stored escrow authority to match the settlement authority signer.
- The deposit instruction does not require the supplied authority account to be the configured authority signer.
- The client does not itself prove authority ownership or server-side evidence before generic in-memory release/refund state is changed.
- The pay API may fall back to `ESCROW_AUTHORITY_WALLET ?? userId`, and can use that same value as the recipient/depositor when no wallet is supplied. It does not establish a Solana keypair or escrow-account binding for this fallback.

**Account ownership checks**

- Anchor `Account<EscrowAccount>` validates escrow account ownership/discriminator and the seeded PDA constraint.
- SOL recipient/depositor are `AccountInfo` values; release/refund equality is enforced, but recipient/depositor account ownership as a wallet is runtime/account-independent.
- USDC token accounts are `Account<TokenAccount>` but lack canonical mint, owner, ATA, and vault identity constraints in the checked-in account contexts.

**PDA signer seeds**

- USDC settlement reconstructs the PDA with `[prefix, escrow.booking_id, escrow.bump]`.
- The bump comes from the initialized account, but the external vault token account and recipient/depositor token accounts are not bound by PDA constraints.

**Privilege escalation**

- Compromise of the authority key can satisfy `authority: Signer` and stored authority equality for all escrows initialized with that authority.
- Compromise of the program upgrade authority can replace behavior, subject to the Solana upgrade mechanism and governance.
- The local program has no pause/freeze, multisig, or authority rotation instruction.

### 5.C Clock skew

**Solana Clock sysvar**

- Deposit instructions call `Clock::get()` and store `created_at`.
- Release/refund receive timestamp arguments and do not call `Clock::get()` or compare the arguments against it.

**Timestamp verification**

- `check_in_timestamp` and `closure_timestamp` are arbitrary signed `i64` values.
- The program stores them but does not enforce positive values, deposit time, current time, not-before/not-after windows, or stale evidence limits.
- Release/refund therefore do not cryptographically prove that a timestamped off-chain event is fresh or related to the booking beyond the off-chain API flow.

**Deadline comparisons**

- The refund cron uses the off-chain database `holdExpiresAt <= now` for eligibility.
- The on-chain program does not enforce `holdExpiresAt`, so an otherwise authorized refund can be submitted outside the DB policy if the caller can construct the instruction.
- No on-chain deadline is used to reject early/late settlement.
- The on-chain program validates neither `created_at` nor timestamp ordering. An auditor must not infer that a client-provided event timestamp has been verified merely because it is stored in the escrow account.

**Boundary conditions**

- An auditor must test exact expiry boundaries, negative timestamps, future timestamps, stale timestamps, and values outside `i64`.
- JavaScript `number` values must be checked before `writeBigInt64LE`; settlement arguments should avoid precision loss and overflow.
- Solana clock and RPC clock may differ slightly; the design must use policy-defined tolerance and should not claim validator clocks are perfectly accurate.

## 6. Security Invariants

| ID                                  | Formal property                                                                                                                                           | Verification status                                                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| I-01 Authorization                  | `release(tx) => tx.authority.signer && tx.authority.key == escrow.authority`; `refund(tx) => tx.authority.signer && tx.authority.key == escrow.authority` | **Verified in source** for settlement instructions                                                                                                 |
| I-02 Recipient binding              | `release(tx) => tx.recipient.key == escrow.recipient`                                                                                                     | **Verified in source**                                                                                                                             |
| I-03 Depositor binding              | `refund(tx) => tx.depositor.key == escrow.depositor`                                                                                                      | **Verified in source**                                                                                                                             |
| I-04 Deposit positive               | `deposit(tx) => D > 0 && C in {SOL, USDC}`                                                                                                                | **Verified in source** for amount; currency context is verified by separate instructions                                                           |
| I-05 Active state                   | `settle(tx) => S = Active`                                                                                                                                | **Verified in source**                                                                                                                             |
| I-06 Single settlement              | Successful settlement changes `S` to `Released` or `Refunded`; a subsequent `settle` requires `S=Active`                                                  | **Verified in source** for a chain-confirmed on-chain account                                                                                      |
| I-07 Release conservation           | `released successfully => R=D && F=0 && B=0`, with no other token or lamport payout                                                                       | **Partially verified**: state and amount are implemented, but USDC accounts/mint and SOL balance execution require deployment/runtime verification |
| I-08 Refund conservation            | `refunded successfully => F=D && R=0 && B=0`, with no other payout                                                                                        | **Partially verified** for program code and exact stored amount, but destination account binding requires verification                             |
| I-09 Booking binding                | `release/refund(tx, b) => b = escrow.booking_id`                                                                                                          | **Verified in source**                                                                                                                             |
| I-10 PDA identity                   | `escrow_address = findPDA([prefix, bookingId_bytes], configured_program_id, bump)`                                                                        | **Verified in source/client**, but deployed program binding is not verifiable from source alone                                                    |
| I-11 Exact deposit                  | A successful SOL/USDC deposit moves exactly `D` and initializes exactly one escrow account                                                                | **Not verifiable without deployed behavior**: the current client does not call the Anchor deposit instructions                                     |
| I-12 Canonical USDC vault           | `vault.owner = escrowPda && vault.mint = USDC_MINT && vault.address = ATA(USDC_MINT, escrowPda)`                                                          | **Not verifiable in source**; account constraints do not enforce all these properties                                                              |
| I-13 Deadline enforcement           | `refund only if now/holdExpiresAt policy permits`; `release/refund timestamp args are within policy`                                                      | **Not verifiable on-chain**                                                                                                                        |
| I-14 Dispute protection             | `S=Active` with unresolved dispute `=> release/refund` rejected                                                                                           | **Not implemented**                                                                                                                                |
| I-15 Idempotent refund              | One booking signature/status and one terminal on-chain refund                                                                                             | **Partially verified**: cron DB claim/signature logic exists; on-chain second settlement is protected after the account becomes terminal           |
| I-16 Transaction confirmation       | DB terminal state requires confirmed/finalized on-chain status or independently verified account state                                                    | **Partially verified**: refund submission/reconciliation checks signature status, but generic client `releaseEscrow` does not broadcast            |
| I-17 State consistency              | On-chain state and database status represent the same terminal outcome                                                                                    | **Not verifiable from source alone**; requires reconciliation and crash testing                                                                    |
| I-18 Account closure                | Settled account can be closed/claimed safely with no remaining funds                                                                                      | **Not implemented**: no close instruction or account close constraint is present                                                                   |
| I-19 Check-in evidence binding      | A release timestamp and check-in evidence correspond to the exact booking, user, venue, and active policy window                                          | **Not verified**: `verifyCheckInForBooking` matches user and venue only and may select a check-in for a different booking                          |
| I-20 Operator-cancellation evidence | `CANCELLED_BY_OPERATOR` is accepted consistently as closure/cancellation evidence                                                                         | **Not implemented** in `verifyVenueClosureForBooking`, which recognizes only `CANCELLED`                                                           |

## 7. External Auditor Security Checklist

### PDA derivation

- [ ] Confirm the deployed program ID equals the source `declare_id` and the environment allowlist.
- [ ] Verify prefix, seed order, UTF-8 encoding, and bump on all deposit/release/refund paths.
- [ ] Test booking IDs of 0, 1, 31, 32, 33, 64, and >64 bytes.
- [ ] Test reused booking IDs and booking IDs that differ only in Unicode normalization or casing.
- [ ] Verify no duplicate PDA can represent two logical escrows under the same program.

### Account validation

- [ ] Verify `EscrowAccount` owner, discriminator, PDA seeds, canonical bump, and initialized state.
- [ ] Verify SOL recipient/depositor accounts before and after settlement.
- [ ] Verify USDC vault mint, owner, ATA derivation, and vault-to-PDA association.
- [ ] Verify depositor USDC token account mint and owner.
- [ ] Verify recipient USDC token account mint and owner.
- [ ] Verify no optional token account can be replaced in a way that diverts funds.

### Signer authorization

- [ ] Verify authority is a signer on release/refund.
- [ ] Verify release/refund authority equals the stored escrow authority.
- [ ] Verify depositor is a signer on deposit.
- [ ] Verify the authority key is not self-selected at deposit.
- [ ] Verify authority rotation, multisig, and upgrade governance.

### Escrow accounting

- [ ] Verify exact deposit amount and no fees/rent are included as spendable principal.
- [ ] Verify release/refund transfer exactly `EscrowAccount.amount`.
- [ ] Verify no remainders or duplicate balances remain after settlement.
- [ ] Verify no rent or fee can be spent through integer arithmetic or lamport mutation.
- [ ] Verify checked arithmetic for amount, balances, base-unit conversion, and timestamps.

### Deposit safety

- [ ] Confirm the deployed client deposit builder invokes the local Anchor `deposit_sol` or `deposit_usdc` instruction.
- [ ] Confirm the deposit instruction initializes the state and transfers principal atomically.
- [ ] Confirm a second deposit cannot overwrite an existing escrow account.
- [ ] Verify duplicate signature and signature-to-booking registration.
- [ ] Verify SOL verification is tied to the exact payer and exact lamport delta.
- [ ] Verify USDC verification inspects instruction/account changes, mint, vault, and amount.

### Dispute handling

- [ ] Confirm whether disputes exist in adjacent application state and are bound to the escrow.
- [ ] Confirm unresolved disputes prevent release/refund.
- [ ] Confirm dispute resolution has explicit authorized roles and cannot be forged.
- [ ] Because no on-chain dispute state exists locally, mark this as unverified until implementation or binding evidence is provided.

### Cancellation

- [ ] Confirm cancellation status is server-authoritative.
- [ ] Confirm cancelled booking refund is not also eligible for release.
- [ ] Confirm duplicate cancellation/refund is terminal on-chain and reconciled off-chain.
- [ ] Verify stale or replayed cancellation evidence cannot trigger settlement.

### Automatic release

- [ ] Confirm a real release worker/broadcast/signing implementation exists if automatic release is required.
- [ ] Verify off-chain `RELEASED` state is written only after confirmation.
- [ ] Verify check-in evidence is bound to booking, user, venue, seat/time, and expiry.
- [ ] Verify no generic in-memory state is treated as on-chain proof.

### Automatic refund

- [ ] Verify atomic database claims and signed-signature persistence.
- [ ] Verify stale claim and rebroadcast behavior.
- [ ] Verify on-chain failure vs pending/unknown signatures.
- [ ] Verify that database `REFUND_PENDING` remains reconciliable after crashes.
- [ ] Verify authority key storage and signer allowlisting.

### Timestamp validation

- [ ] Add on-chain or signed off-chain checks for check-in/closure timestamps.
- [ ] Compare deadlines with Solana Clock using deliberate tolerance.
- [ ] Test future, negative, stale, pre-deposit, and post-settlement timestamps.
- [ ] Test i64 and JavaScript integer conversion boundaries.

### CPI/re-entrancy

- [ ] Test SPL Token CPI success and failure.
- [ ] Test state/balance rollback after CPI failure.
- [ ] Test duplicate instruction and duplicate transaction replay.
- [ ] Confirm external program calls cannot execute settlement logic before account checks.

### Transaction atomicity and confirmation

- [ ] Verify deposit/settlement instruction sequence.
- [ ] Verify `confirmed` and `finalized` status semantics.
- [ ] Query independent RPC nodes or a quorum for settlement confirmation.
- [ ] Verify database reconciliation is not based on a single RPC provider response.

### Adversarial testing

- [ ] Substitute wrong PDA, wrong program ID, wrong mint, wrong vault, wrong recipient, wrong depositor, and wrong authority.
- [ ] Replay old signed transactions after state changes.
- [ ] Submit stale blockhashes and expired transactions.
- [ ] Race concurrent refund/release/registration requests.
- [ ] Test authority-key and program-upgrade compromise response procedures.

## 8. Testing Recommendations

The repository has mocked unit coverage for PDA derivation, deposit serialization, SOL deposit verification, instruction construction, refund submission, and refund status reconciliation. It does not itself establish deployed on-chain behavior.

### 8.1 PDA and authority tests

- Invalid, empty, and non-string booking IDs.
- 32-, 33-, 64-, and >64-byte UTF-8 booking IDs.
- Same booking ID with different program IDs.
- Wrong authority at release/refund.
- Wrong recipient/depositor account.
- PDA with canonical and non-canonical bump values.
- Missing and substituted USDC token accounts.
- Wrong USDC mint and wrong vault owner.

### 8.2 Deposit tests

- Duplicate deposit to an existing booking PDA.
- Duplicate depositor transaction signatures for the same booking.
- Different payer and expected payer.
- SOL transfer below, equal to, and above the expected amount.
- USDC transfer below, equal to, and above the expected amount.
- USDC transfer to the wrong ATA or wrong mint.
- Deposit transaction that succeeds without the expected Anchor/deposit instruction.
- Deposit instruction followed by settlement in one or separate transactions.

### 8.3 Settlement tests

- First release and first refund from `Active`.
- Duplicate release.
- Duplicate refund.
- Release after refund.
- Refund after release.
- Different booking ID in instruction and escrow account.
- Disputed escrow release, if dispute behavior is introduced.
- Cancelled booking release.
- Active booking refund outside expiry policy.
- Concurrent release/refund from separate submitters.

### 8.4 Deadline tests

- Check-in timestamp before deposit.
- Check-in timestamp exactly at deposit time and at policy boundaries.
- Future and negative check-in timestamps.
- Closure timestamp before deposit and after settlement.
- Hold expiry one second before, exactly at, and one second after `now`.
- Clock skew/validator timestamp drift within and outside policy tolerance.

### 8.5 Arithmetic and account tests

- `amount = 0`, negative source values, and maximum `u64` values.
- JavaScript conversion loss for SOL lamports and USDC micro-units.
- Vault balance lower than `EscrowAccount.amount`.
- Integer overflow attempts in Rust and TypeScript.
- Wrong SPL Token account owner or mint.
- Missing optional USDC accounts.
- Reverted CPI with pre/post balance and state snapshots.
- Check-in records from two bookings sharing a user and venue; verify only the exact booking record may satisfy release.
- Active check-in evidence for a cancelled, completed, mismatched, or expired booking.
- `CANCELLED` and `CANCELLED_BY_OPERATOR` cancellation statuses through both refund and closure verification.

### 8.6 Operational tests

- Missing/invalid authority key.
- Missing/invalid program ID.
- Signature persistence failure before broadcast.
- Broadcast failure after signature persistence.
- Confirmed, finalized, processed, unknown, reverted, and stale statuses.
- RPC failover disagreement and timeout.
- Stale refund claim recovery.
- Concurrent cron claims.
- Database write failure after on-chain confirmation.

## 9. Audit Limitations

The following guarantees require direct verification of the deployed or a build-identical local on-chain program:

- that the `declare_id` program is deployed at `NEXT_PUBLIC_ESCROW_PROGRAM_ID`;
- that the deployed IDL/discriminator/account layout matches this source;
- that deposit and settlement account constraints match the source and are enforced for the exact instruction;
- that caller-supplied authority and recipient/depositor values cannot be substituted at deposit;
- that USDC mint, owner, ATA, and vault constraints are canonical;
- that no settlement occurs for unresolved disputes or outside cancellation policy;
- that timestamps are validated against a canonical Clock/clock policy;
- that no arithmetic or SPL CPI path permits overpayment or underpayment;
- that the deployed program has no emergency override or hidden upgrade-time change;
- that the authority key and upgrade authority are not a single point of compromise;
- that database and on-chain state converge after all crash and RPC failure modes;
- that on-chain state is the source of truth rather than in-memory or database optimistic state.

The repository proves client and server behaviors, but it does not prove deployed behavior. The external auditor should obtain deployed bytecode/IDL, the deployed upgrade authority, the program account, and the exact cluster/authority configuration before assigning a production security assurance level.
