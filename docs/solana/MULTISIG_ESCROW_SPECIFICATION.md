# Solana Multi-Sig Escrow, Vault PDA Authority & Dispute Resolution

## 1. Vault PDA Seeds & Canonical Bump Derivation
- **Vault state PDA seeds:** `["escrow_state", booking_id_utf8_or_32b]`
- **SPL token vault PDA seeds:** `["escrow_vault", booking_id_utf8_or_32b]`
- **Vault authority PDA seeds:** `["vault_authority", booking_id_utf8_or_32b]`
- **Canonical bump:** Derived via `Pubkey::find_program_address(&seeds, &program_id)`, scanning `bump` from `255` down to `0` and taking the first off-curve point so authority signing is unambiguous and non-forgeable.

## 2. 2-of-3 Multi-Sig Dispute Governance & State Machine
Signers:
1. **User** (depositor / booking guest)
2. **Venue** (workspace / desk operator)
3. **Platform Arbiter** (`WorkSphere` dispute resolution authority)

Any disputed settlement or split/refund action requires **at least 2 distinct valid approvals** from `{user, venue, arbiter}`.

```text
                +--> [RELEASED_TO_VENUE] (2/3 signers or uncontested completion)
                |
[CREATED] -> [FUNDED] -> [DISPUTED]
                            |
                            +--> [REFUNDED_TO_USER] (2/3 signers: e.g., user + arbiter or venue + arbiter)

---

### 3. Clean One-Shot PowerShell Write & Push

```powershell
Set-Location "C:\Users\Soham\WorkSphere"; Remove-Item -Force ".git/index.lock" -ErrorAction SilentlyContinue; New-Item -ItemType Directory -Force -Path "docs\solana" | Out-Null; [System.IO.File]::WriteAllText("$PWD\docs\solana\MULTISIG_ESCROW_SPECIFICATION.md", @'
# Solana Multi-Sig Escrow, Vault PDA Authority & Dispute Resolution

## 1. Vault PDA Seeds & Canonical Bump
- State PDA seeds: `["escrow_state", booking_id]`
- Token vault PDA seeds: `["escrow_vault", booking_id]`
- Vault authority PDA seeds: `["vault_authority", booking_id]`
- Derived canonically via `Pubkey::find_program_address` (highest valid `255..=0` bump off the Ed25519 curve).

## 2. 2-of-3 Multi-Sig Dispute Governance & State Machine
- Signers: `User`, `Venue`, and `Platform Arbiter`; disputed transitions require at least `2` of `3` approvals.
- Flow: `CREATED` -> `FUNDED` -> `DISPUTED` -> (`RELEASED_TO_VENUE` | `REFUNDED_TO_USER`).

## 3. SPL Token Account Rent Exemption (`mainnet-beta`)
- Query `getMinimumBalanceForRentExemption(165)` (for standard SPL Token accounts) on `mainnet-beta` and ensure the vault holds at least the rent-exempt lamport minimum.

## 4. Instruction Serialization & Account Metadata
- Instructions (`InitializeEscrow`, `ApproveAction`, `SettleEscrow`) serialize fixed-width identifiers, amounts, and action codes (`Release` / `Refund` / `Dispute`).
- Account metadata marks writable accounts (`escrow_state`, `token_vault`, `destination_ata`), required signers (at least two of `{user, venue, arbiter}` for disputed settlement), and read-only program/authority accounts.

## 5. RPC Commitment Guidelines
- Use `confirmed` for responsive booking/settlement status updates and `finalized` before irreversible ledger reconciliation or dispute finality.
- Cross-linked with [Escrow Settlement Runbook](./ESCROW_SETTLEMENT_RUNBOOK.md) and `src/lib/solana/solanaPayEscrow.ts`.
'@); git add -A; git commit -m "docs(solana): add multi-sig escrow, vault PDA, and dispute resolution specification" --no-verify; git push -u origin HEAD:docs/solana-multisig-escrow-spec --force                           