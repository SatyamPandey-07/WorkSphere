# Enterprise SAML 2.0 & OAuth2 PKCE Authentication Architecture

## 1. Overview

WorkSphere supports seamless Enterprise Single Sign-On (SSO) to integrate with corporate Identity Providers (IdPs) such as Okta, Microsoft Entra ID (Azure AD), and Google Workspace. The platform implements two primary protocols:
* **SAML 2.0** for legacy and traditional enterprise identity federation.
* **OAuth2 + OIDC with PKCE** for modern, highly secure mobile and web client authentication.

This architecture ensures deep multi-tenant isolation, cryptographically verifiable assertions, and defense against authorization code interception attacks.

---

## 2. Multi-Tenant Identity Isolation

WorkSphere operates a strictly isolated multi-tenant architecture. Identity resolution and data boundaries are enforced at the authentication layer before any session token is issued.

| Mechanism | Description | Enforcement Level |
| :--- | :--- | :--- |
| **Domain-Based Routing** | Users entering their email (e.g., `user@company.com`) are dynamically mapped to their tenant's specific IdP configuration. | Pre-Auth (Login Gateway) |
| **Tenant ID Claim (`tid`)** | Issued JWTs contain a cryptographic `tid` claim. All backend microservices validate this claim against the requested resource's tenant owner. | API Gateway & Service Layer |
| **JIT Provisioning Isolation** | Just-In-Time provisioned accounts via SSO are strictly bound to the Tenant ID associated with the validated IdP profile. | Database Layer (Row-Level Security) |

---

## 3. SAML 2.0 Protocol & XML Assertion Validation

For organizations utilizing SAML 2.0, WorkSphere acts as the **Service Provider (SP)**. We enforce strict validation on incoming XML responses to prevent XML Signature Wrapping (XSW) and assertion replay attacks.

### 3.1 X.509 Certificate Validation & Trust
* **Strict Signature Verification:** Every SAML Response and Assertion *must* be digitally signed by the IdP. The XML signature is verified using the public X.509 certificate configured for that specific tenant.
* **Algorithm Requirements:** Signatures must utilize `RSA-SHA256` or higher. `SHA1` is explicitly rejected.

### 3.2 Assertion Validation Matrix

| Validation Check | Protocol Standard | Security Purpose |
| :--- | :--- | :--- |
| **Audience Restriction** | `<Audience>` must exactly match the WorkSphere SP Entity ID. | Prevents token reuse from other SPs. |
| **Destination Matching** | `Destination` attribute must match the exact WorkSphere ACS (Assertion Consumer Service) URL. | Prevents IdP response interception/forwarding. |
| **Timestamp Checks** | `NotBefore` and `NotOnOrAfter` must be valid (with a max 3-minute clock skew). | Prevents replay attacks using captured old assertions. |
| **InResponseTo** | Must match the ID of the original SAML AuthnRequest. | Mitigates IdP-initiated login CSRF vulnerabilities. |

---

## 4. OAuth2 with PKCE (Proof Key for Code Exchange)

For modern integrations and SPA/Mobile clients, WorkSphere utilizes the OAuth2 Authorization Code flow enhanced with **PKCE (RFC 7636)**. PKCE completely replaces the need for static client secrets, which cannot be safely stored in browsers or mobile apps.

### 4.1 PKCE Flow Execution
1. **Code Verifier Generation:** The client generates a high-entropy cryptographically random string (the `code_verifier`).
2. **Code Challenge Creation:** The client hashes the verifier using SHA-256 and base64url-encodes it to create the `code_challenge`.
3. **Authorization Request:** Client redirects to the IdP with `code_challenge` and `code_challenge_method=S256`.
4. **Code Issuance:** The IdP authenticates the user and returns a temporary Authorization Code.
5. **Token Exchange:** The client sends the Authorization Code *and* the original plaintext `code_verifier` to the WorkSphere token endpoint.
6. **Validation:** The server hashes the `code_verifier` and compares it to the previously stored `code_challenge`. If they match, JWT access and refresh tokens are issued.

```javascript
// Example: Client-side PKCE Challenge Generation
const codeVerifier = generateRandomString(64); // Stored in sessionStorage
const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
const codeChallenge = base64URLEncode(new Uint8Array(hash)); 
// Sent to IdP authorization endpoint
```
## 5. Security Token Exchange & Session Management

| Token Type | Lifespan | Storage Mechanism | Security Controls |
| :--- | :---: | :--- | :--- |
| **Access Token (JWT)** | `15 Minutes` | In-Memory (React / State) | Stateless verification via asymmetric public keys (`RS256`). Contains `tid` for tenant isolation. |
| **Refresh Token** | `7 Days` | `HttpOnly`, `Secure`, `SameSite=Strict` Cookie | Stateful session management. Evaluated against Redis blocklist on rotation; bound to client device fingerprint. |
| **Session State Key** | `Session Duration` | `IndexedDB` (Encrypted) | Non-extractable key context used to decrypt local workspace payloads post-SSO authentication. |