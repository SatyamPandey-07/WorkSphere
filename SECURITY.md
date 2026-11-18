# Security Policy

## Supported Versions

Security fixes are applied to the `main` branch and the latest production deployment. Older branches, forks, and unmerged pull requests are supported on a best-effort basis only.

| Version                   | Supported   |
| ------------------------- | ----------- |
| `main` (latest)           | Yes         |
| Latest production release | Yes         |
| Older releases / forks    | Best effort |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Select **Report a vulnerability**.
3. Include a clear description, affected component, reproduction steps or proof of concept, impact, and any suggested fix.

If private reporting is unavailable, contact the maintainers through the repository's published security contact rather than disclosing the issue publicly.

Please include:

- The affected commit, branch, deployment, or program ID.
- Whether the issue affects the web application, the Solana Anchor escrow program, the client SDK, the refund cron, or infrastructure.
- Preconditions and the attacker's required capabilities.
- A minimal reproduction or transaction signature where possible.
- Any logs or screenshots with secrets and personal data removed.

## What to Expect

- We aim to acknowledge reports within 3 business days.
- We will investigate, reproduce, and assign a severity using the rubric in the relevant threat model.
- We will keep you informed of remediation progress and coordinate disclosure.
- We will credit reporters in the advisory unless you request anonymity.
- Please allow us reasonable time to remediate before public disclosure. We aim to publish an advisory within 90 days of a confirmed issue, sooner for critical issues.

## Scope

In scope:

- The WorkSphere web application, API routes, authentication, authorization, and data handling.
- The Solana Anchor escrow program in `programs/worksphere-escrow/`.
- The Solana client SDK and payment flows in `src/lib/solana/`, `src/lib/payments/`, and `src/app/api/pay/solana/`.
- The automated escrow refund cron and settlement workers.
- Smart contract authority, upgrade authority, and key-management configuration.
- Dependency and supply-chain issues that affect production.

Out of scope:

- Social engineering, phishing, and physical attacks.
- Denial-of-service testing that degrades production service for other users.
- Issues requiring a compromised user device, wallet extension, or browser.
- Findings that require access to a maintainer's personal accounts or infrastructure.
- Reports generated solely by automated scanners without a demonstrated impact.
- Third-party services (Solana validators, RPC providers, Clerk, Stripe, Cloudinary) unless the issue is caused by WorkSphere's integration.

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, service disruption, and data destruction.
- Only test accounts and data they own or have explicit permission to use.
- Report findings privately and give us reasonable time to remediate.
- Do not exploit a vulnerability beyond the minimum needed to demonstrate it.

## Security Documentation

- **[Escrow Smart Contract Threat Model & Audit Specification](docs/security/ESCROW_SMART_CONTRACT_THREAT_MODEL.md)** — STRIDE matrix for `deposit_sol`, `deposit_usdc`, `release`, and `refund`; PDA derivation and collision resistance; replay and timestamp defenses; token-account binding; emergency freeze and multisig recommendations; Anchor and Trident fuzzing instructions.
- [Security Architecture Overview](docs/security/SECURITY_OVERVIEW.md) — CSP nonces, CSRF protection, and rate limiting.
- [Solana Gasless Relayer Threat Model](docs/security/solana-relayer-threat-model.md) — fee-payer authorization, treasury caps, and RPC replay defenses.
- [Cryptographic Booking Receipt Specification](docs/security/cryptographic-receipt-spec.md).
- [WebAuthn Passkey Security Guide](docs/security/passkey-webauthn-guide.md).
- [Documentation index](docs/README.md).

## Security Practices for Contributors

- Never commit secrets, private keys, authority keypairs, or production `.env` files.
- Do not log `SOLANA_ESCROW_AUTHORITY_SECRET_KEY`, signed transaction bytes, session tokens, or personal data.
- Use the canonical program ID and USDC mint from configuration; never accept them from an untrusted request.
- Treat all RPC responses as untrusted and verify settlement against finalized on-chain state.
- Add tests for negative authorization, replay, account substitution, and boundary conditions when changing payment or escrow code.
- Report suspected key compromise immediately through the private channel above.
