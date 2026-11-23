# Session Management & Clerk-Native Session Lifecycle Guide

> [!IMPORTANT]
> **Architecture Update: Migration to Clerk-Native Session Lifecycle**
> WorkSphere delegates authentication, token issuance, session activity tracking, and token rotation natively to **Clerk** (`@clerk/nextjs`).
> The legacy custom token-family rotation implementation (`src/lib/auth/sessionTokens.ts`) and the custom session endpoints (`/api/auth/session/refresh`, `/api/auth/session/logout`) have been retired (HTTP 410 Gone).
> Process-local memory maps (`tokenFamilyStore = new Map()`, `usedJtis = new Set()`) cannot coordinate state across serverless instances or multi-container deployments. All production session extension and termination now utilize Clerk's official session management primitives (`useSession()`, `session.touch()`, `session.getToken({ skipCache: true })`, and `useClerk().signOut()`).

This technical security guide documents WorkSphere's session management architecture, comparing the retired custom token-family model with the production Clerk-native session lifecycle.

---

## 1. Overview & Threat Model

### 1.1 Access Tokens vs. Refresh Tokens

Modern web applications balance user experience (seamless sessions) with credential security:

- **Access Tokens (`worksphere_access_token`)**:
  - Short-lived JWTs (15 minutes / `ACCESS_TOKEN_EXPIRY_SECONDS = 900`).
  - Signed using HMAC-SHA256 (`HS256`) via WebCrypto APIs.
  - Carried in requests to authenticate API interactions without hitting the database for session state.
- **Refresh Tokens (`worksphere_refresh_token`)**:
  - Long-lived credentials (7 days / `REFRESH_TOKEN_EXPIRY_SECONDS = 604,800`).
  - Kept inside secure, `HttpOnly`, `SameSite=Lax` cookies.
  - Used exclusively against `/api/auth/session/refresh` to obtain new access tokens.

### 1.2 The Threat of Static Refresh Tokens

In systems with static, long-lived refresh tokens, if a token is intercepted (via cross-site scripting, rogue extensions, packet inspection on insecure networks, or physical device access), an adversary can maintain unauthorized API access indefinitely until the token expires—even if the legitimate user continues their normal session.

WorkSphere neutralizes this threat through **Refresh Token Rotation (RTR)** coupled with **Token Family Reuse Detection**.

---

## 2. Refresh-Token Rotation Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Client as User Browser
    participant API as /api/auth/session/refresh
    participant Sec as sessionTokens.ts
    participant DB as PostgreSQL (Prisma)

    Client->>API: POST /api/auth/session/refresh (Cookie: worksphere_refresh_token)
    API->>Sec: verifyJwt(refreshToken, { checkPasswordChange: true })
    Sec-->>API: Return claims { sub, familyId, version, jti, iat, exp }

    API->>DB: prisma.user.findUnique({ where: { id: userId } })
    DB-->>API: Return user record (including passwordChangedAt)

    alt Token Issued Before Password Change (iat < passwordChangedAt)
        API-->>Client: HTTP 401 Unauthorized (code: STALE_REFTERM)
    else Token Fresh
        API->>Sec: rotateRefreshToken(refreshToken, undefined, passwordChangedAt)
        alt Token Reuse Detected (jti already used / version mismatch)
            Sec->>Sec: Invalidate Entire Family (record.revoked = true)
            Sec-->>API: Return { success: false, error: "REUSE_DETECTED" }
            API-->>Client: HTTP 401 Unauthorized (code: REUSE_DETECTED)
        else Valid Rotation
            Sec->>Sec: Mark old jti as used; increment version
            Sec->>Sec: Generate new jti; sign new access + refresh JWTs
            Sec-->>API: Return new tokens
            API-->>Client: HTTP 200 OK + Set-Cookie: worksphere_refresh_token (new token)
        end
    end
```

### Step-by-Step Lifecycle Implementation:

1. **Initial Issuance (`generateRefreshToken`)**:
   - Generates random 128-bit hex identifiers for `familyId` and `jti` (`generateRandomHex(16)`).
   - Initializes record: `{ familyId, userId, currentJti: jti, version: 1, revoked: false, expiresAt }`.
   - Returns signed JWT containing `RefreshTokenClaims`.
2. **Refresh Presentation (`/api/auth/session/refresh/route.ts`)**:
   - Reads `worksphere_refresh_token` from incoming HTTP request cookies (with fallback to JSON body).
   - Verifies JWT integrity and expiration via `verifyJwt()`.
3. **Password Change Liveness Check**:
   - Queries `prisma.user.findUnique()` to obtain `passwordChangedAt`.
   - If `iat < Math.floor(user.passwordChangedAt.getTime() / 1000)`, request is immediately rejected with HTTP 401 (`STALE_REFTERM`).
4. **Token Rotation & Invalidation (`rotateRefreshToken`)**:
   - Validates that `claims.familyId` exists and is not marked `revoked`.
   - Evaluates reuse: if `jti` has already been recorded in `usedJtis`, or `record.currentJti !== jti`, or `record.version !== version`, a replay attack is triggered.
   - If valid, adds current `jti` to `usedJtis`.
   - Increments `version`, assigns new `jti`, and signs a new refresh token and access token.
5. **Cookie Replacement**:
   - Sets fresh `worksphere_refresh_token` cookie via `getRefreshCookieOptions()`.

---

## 3. Refresh-Token Families

### 3.1 What is a Token Family?

A **Token Family** links all rotated generations of a refresh token to an initial authentication session:
$$\text{Family} = (\text{familyId}, \text{userId}, \text{currentJti}, \text{version}, \text{revoked})$$

### 3.2 Family Successor Chains

When a user logs in, Generation 1 is minted:

```
[Gen 1: v=1, jti=A] ──(rotate)──► [Gen 2: v=2, jti=B] ──(rotate)──► [Gen 3: v=3, jti=C]
```

- Each rotation generates a new single-use `jti` (JWT ID).
- The family registry in `src/lib/auth/sessionTokens.ts` (`tokenFamilyStore = new Map<string, RefreshTokenRecord>()`) tracks the current authoritative `jti` and active `version`.
- Any attempt to use an ancestor token (`jti=A` or `jti=B`) after `jti=C` has been issued violates the single-use invariant.

---

## 4. Refresh-Token Reuse & Replay Detection

### 4.1 The Replay Attack Scenario

Consider an attacker who intercepts a valid refresh token on public Wi-Fi or via compromised local storage:

```mermaid
sequenceDiagram
    autonumber
    participant Legitimate as Legitimate User
    participant Attacker as Attacker (Stolen Token)
    participant Server as WorkSphere Auth (/api/auth/session/refresh)

    Note over Legitimate,Attacker: Both possess Token Gen 1 (jti=A, v=1)
    Legitimate->>Server: Refresh Session with Gen 1 (jti=A)
    Server->>Server: Validate Gen 1; mark jti=A used; issue Gen 2 (jti=B, v=2)
    Server-->>Legitimate: Return Gen 2 (jti=B)

    Note over Attacker: Attacker attempts to use stolen Gen 1
    Attacker->>Server: Refresh Session with Gen 1 (jti=A)
    Server->>Server: REUSE DETECTED! jti=A is in usedJtis & currentJti is B (v=2)
    Server->>Server: Mark entire familyId as REVOKED (theft containment)
    Server-->>Attacker: HTTP 401 Unauthorized (code: REUSE_DETECTED)

    Note over Legitimate: Legitimate user's next refresh attempt
    Legitimate->>Server: Refresh Session with Gen 2 (jti=B)
    Server->>Server: Family is REVOKED!
    Server-->>Legitimate: HTTP 401 Unauthorized (code: REVOKED)
    Note over Legitimate: User is forced to re-authenticate; attacker is permanently locked out
```

### 4.2 Why Immediate Family Invalidation is Essential

When the server observes an already-consumed token (`jti` in `usedJtis`), it cannot determine whether the presenter is the attacker or the legitimate user. By immediately marking the **entire family** as `revoked: true`:

1. The attacker cannot rotate the stolen token to obtain fresh access tokens.
2. The legitimate user is prompted to sign in again, terminating the compromised session.
3. The compromise window is restricted to the lifetime of any in-flight 15-minute access token.

---

## 5. Password-Reset & Password-Change Revocation

### 5.1 Verified Prisma Schema Field

Inspected in `prisma/schema.prisma` line 18:

```prisma
model User {
  id                   String                @id
  email                String?               @unique
  ...
  passwordChangedAt    DateTime?
  ...
}
```

- **Field Name**: `passwordChangedAt`
- **Data Type**: `DateTime?` (PostgreSQL `timestamp with time zone`)

### 5.2 Verification Logic in Token Refresh (`src/app/api/auth/session/refresh/route.ts`)

When `/api/auth/session/refresh` processes a rotation request:

```typescript
const user = await prisma.user.findUnique({ where: { id: userId } });
const passwordChangedAt = user?.passwordChangedAt
  ? Math.floor(user.passwordChangedAt.getTime() / 1000)
  : undefined;

if (
  passwordChangedAt !== undefined &&
  typeof iat === "number" &&
  iat < passwordChangedAt
) {
  return NextResponse.json(
    {
      error:
        "Session invalidated. Your password was changed on another device. Please sign in again.",
      code: "STALE_REFTERM",
    },
    { status: 401 },
  );
}
```

- **Security Objective**: If a user changes their password on Device A, any refresh tokens held on Device B, Device C, or by an adversary will have an `iat` (issued at) timestamp prior to `passwordChangedAt`. Upon their next refresh attempt, all existing sessions are invalidated immediately.

---

## 6. Cookie Security & Public Wi-Fi Hardening

### 6.1 Verified Cookie Configuration (`src/lib/auth/sessionTokens.ts`)

```typescript
export function getRefreshCookieOptions(
  maxAgeSeconds = REFRESH_TOKEN_EXPIRY_SECONDS,
) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
```

### 6.2 Cookie Security Attributes Explained:

- **`HttpOnly: true`**:
  - The cookie cannot be accessed via JavaScript (`document.cookie`).
  - Protects refresh tokens from exfiltration through Cross-Site Scripting (XSS) attacks.
- **`Secure: process.env.NODE_ENV === "production"`**:
  - Directs browsers to transmit the cookie exclusively over encrypted TLS/HTTPS channels.
  - Prevents plaintext transmission over unencrypted HTTP.
- **`SameSite: "lax"`**:
  - Restricts cookies on cross-origin requests.
  - Automatically sent when navigating to the site from external links, but withheld on cross-origin `POST`, `PUT`, or `DELETE` requests, mitigating Cross-Site Request Forgery (CSRF).
- **`Path: "/"`**:
  - Scopes the refresh cookie across all application routes.

### 6.3 Public Wi-Fi Risks & Mitigation Boundaries

> [!WARNING]
> While `HttpOnly` and `Secure` cookies provide essential baseline protection, they **do not** make an application immune to all threats on untrusted networks:
>
> - **TLS Termination & MitM**: Users on public Wi-Fi must be protected by strict HSTS (`Strict-Transport-Security`) to prevent SSL stripping attacks.
> - **Compromised Endpoints**: If an attacker gains access to a user's local operating system or browser profile, cookies can be extracted directly from browser storage files regardless of `HttpOnly` flags.
> - **Defense-in-Depth**: RTR and token-family invalidation ensure that even if a cookie is copied from disk, its first reuse triggers automatic session revocation.

---

## 7. OAuth & External Identity Architecture

WorkSphere leverages **Clerk** as its authoritative primary identity provider and OAuth coordinator:

1. **OAuth Sign-In Flow**:
   - User initiates OAuth (Google, GitHub, Microsoft) via Clerk's frontend components.
   - Clerk handles PKCE (Proof Key for Code Exchange) and OAuth state parameters to defeat CSRF.
2. **Webhook Synchronization**:
   - User creation and profile updates are streamed to `/api/webhooks/clerk`.
   - Verified via Svix HMAC-SHA256 signatures (`svix-id`, `svix-timestamp`, `svix-signature`).
3. **Session Refresh Bridge**:
   - For internal services, WorkSphere issues companion JWT session cookies (`worksphere_access_token` and `worksphere_refresh_token`).
   - Enables fine-grained rotation and rapid invalidation independent of external IdP token latencies.

---

## 8. Concrete Attack Scenarios & Mitigations

| Attack Scenario                        | Threat & Risk                                                                    | WorkSphere Existing Defense                                                                                    | Recommended Additional Protection                                          |
| :------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| **Stolen Refresh Token**               | Attacker obtains cookie and attempts unauthorized session renewal.               | Refresh token rotation issues new credentials on each use; `HttpOnly` blocks JS exfiltration.                  | IP / User-Agent anomaly binding on refresh.                                |
| **Reuse of Rotated Token**             | Attacker replays an intercepted previous refresh token.                          | **Token Family Reuse Detection**: `usedJtis.has(jti)` marks family revoked; returns HTTP 401 `REUSE_DETECTED`. | Push notification alerting user to token reuse event.                      |
| **Stolen Session Cookie**              | Attacker extracts cookie from physical device or compromised browser.            | Short-lived access token (15m); token rotation invalidates predecessor upon legitimate user refresh.           | WebAuthn step-up reauthentication for sensitive mutations.                 |
| **Password Changed on Another Device** | Compromised old device retains refresh token after password reset.               | **`passwordChangedAt` timestamp check**: `iat < passwordChangedAt` triggers HTTP 401 `STALE_REFTERM`.          | Immediate Redis blacklist broadcast across edge instances.                 |
| **Concurrent Refresh Race**            | Multiple browser tabs refresh simultaneously causing accidental reuse detection. | Single-flight promise coalescence in client; sequential family versioning.                                     | Short grace period ($10\text{s}$) for concurrent refreshes in same family. |
| **Cross-Site Request Forgery (CSRF)**  | Malicious third-party site submits unauthorized state-changing request.          | Double-submit CSRF cookie (`csrf_token`) verified against `x-csrf-token` header; `SameSite=Lax`.               | `SameSite=Strict` on high-risk mutation endpoints.                         |
| **Public Wi-Fi Interception**          | Eavesdropper monitors unencrypted Wi-Fi traffic.                                 | `Secure` cookie flag mandates TLS 1.3; strict CSP prevents script injection.                                   | Preloaded HSTS header (`includeSubDomains; preload`).                      |

---

## 9. Session Revocation & Logout

### 9.1 Single-Session Logout (`POST /api/auth/session/logout`)

Verified in `src/app/api/auth/session/logout/route.ts`:

1. Reads `worksphere_refresh_token` from cookie.
2. Invokes `revokeRefreshTokenFamily(refreshToken)`:
   - Sets `record.revoked = true` in `tokenFamilyStore`.
3. Clears cookies in response:
   - `response.cookies.delete("worksphere_refresh_token")`
   - `response.cookies.delete("worksphere_access_token")`
   - `response.cookies.delete("worksphere_demo_session")`
   - `response.cookies.delete("worksphere_user_email")`

### 9.2 Invalidation of In-Flight Access Tokens

- Access tokens are stateless JWTs signed with `HS256`.
- Once issued, an access token remains cryptographically valid until its 15-minute expiration (`exp`), unless explicitly validated against a revocation blacklist.
- **Design Tradeoff**: WorkSphere optimizes for high throughput by verifying access tokens statelessly in edge middleware. Session revocation takes effect immediately upon the next refresh cycle (at most 15 minutes).

---

## 10. Operational Security Recommendations

1. **Persistent Distributed Family Store**:
   - Currently, `tokenFamilyStore` in `sessionTokens.ts` uses an in-memory `Map`. For multi-instance production deployments, back this store with Redis using atomic `HSET` and transactions (`MULTI/EXEC`) to share rotation state across cluster nodes.
2. **Refresh Grace Window**:
   - Implement a 10-second grace window during token rotation to allow near-simultaneous requests from multiple browser tabs without triggering false-positive `REUSE_DETECTED` revocations.
3. **Database-Backed Session Audit Log**:
   - Persist token theft events (`REUSE_DETECTED`) to an administrative audit table (`AdminAuditLog`) with client IP and user agent for security monitoring.
4. **Secret Management**:
   - Ensure `SESSION_SECRET` is at least 256 bits (32 characters) of cryptographically random entropy and rotated periodically via environment variables.

---

## 11. References

- [Session Token & Rotation Management Source](../../src/lib/auth/sessionTokens.ts)
- [Refresh Route Handler](../../src/app/api/auth/session/refresh/route.ts)
- [Logout Route Handler](../../src/app/api/auth/session/logout/route.ts)
- [CSRF Security Module](../../src/lib/security/csrf.ts)
- [Prisma Schema Definition](../../prisma/schema.prisma#L18)
- [Security Architecture Overview](../SECURITY_ARCHITECTURE.md)
- [RFC 6749: OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 6750: OAuth 2.0 Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
