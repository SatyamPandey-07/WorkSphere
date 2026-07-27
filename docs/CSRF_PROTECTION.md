# CSRF Protection & Double-Submit Cookie Validation

## 1. Architecture Overview

To protect against Cross-Site Request Forgery (CSRF) attacks, this application utilizes the **Double-Submit Cookie** pattern.

When a client authenticates or requests a token via `/api/auth/csrf-token`, the server generates a cryptographically strong random value. This value is:

1. Set as an HTTP-only, secure cookie on the client's browser.
2. Returned in the response payload to be stored in the application state (e.g., in memory).

For any subsequent state-modifying request, the client must include this token in a custom HTTP header (`x-csrf-token`). The server then compares the token in the header against the token in the cookie. If they match, the request is authorized.

## 2. Exemptions

Not all routes require CSRF validation.

**Safe HTTP Methods:**
Read-only requests do not modify state and are inherently exempt from CSRF checks. The middleware will bypass validation for:

- `GET`
- `HEAD`
- `OPTIONS`

**Public Webhook Routes:**
External webhooks (e.g., payment gateways or third-party integrations) cannot read our cookies to send the double-submit header. These routes bypass CSRF validation and instead rely on their own specific cryptographic signature verification.

## 3. Middleware Inspection

The core CSRF validation logic lives in `src/middleware.ts`.

For all incoming `POST`, `PUT`, `PATCH`, and `DELETE` requests, the middleware intercepts the request and extracts:

1. The token from the client's cookie.
2. The token provided in the `x-csrf-token` HTTP header.

If either is missing, or if the two values do not strictly match, the middleware rejects the request with a `403 Forbidden` status before it ever reaches the API route handlers.

## 4. Example: Fetch Wrapper

When making API mutations from the frontend, you must ensure the CSRF token is attached to the headers. Here is an example of how to wrap the native `fetch` API to handle this automatically:
