/**
 * webauthnPasskey.ts
 *
 * Client-side WebAuthn passkey step-up authentication utility for high-value wallet operations
 * (escrow settlement, balance refunds, or transfers exceeding transaction policy limits).
 *
 * Handles:
 * 1. WebAuthn browser feature detection & platform authenticator availability.
 * 2. Backend challenge acquisition bound to authenticated user and transaction context.
 * 3. Invoking navigator.credentials.get() with proper options, allowList, and timeout handling.
 * 4. Serializing PublicKeyCredential assertion response.
 * 5. Submitting assertion to trusted backend for cryptographic signature verification.
 * 6. Email OTP step-up fallback when WebAuthn is unavailable, rejected, or unsupported.
 */

import type {
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";

export type StepUpAction = "wallet_transfer" | "escrow_settle" | "refund" | "high_value_payment";

export interface TransactionContext {
  action: StepUpAction;
  amount: number;
  recipient?: string;
  currency?: string;
  reference?: string;
}

export type StepUpAuthResultType =
  | "success"
  | "unsupported_browser"
  | "no_platform_authenticator"
  | "user_cancelled"
  | "authenticator_rejected"
  | "challenge_expired"
  | "network_error"
  | "verification_failed"
  | "otp_fallback_required";

export interface StepUpAuthResult {
  success: boolean;
  type: StepUpAuthResultType;
  stepUpToken?: string;
  error?: string;
  credentialId?: string;
  usedFallback?: boolean;
}

export interface StepUpChallengeResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
  action: string;
  challengeId?: string;
  userPasskeysCount?: number;
}

export interface EmailOtpRequestParams {
  action: StepUpAction;
  amount: number;
  recipient?: string;
}

export interface EmailOtpRequestResult {
  success: boolean;
  maskedEmail?: string;
  expiresInSeconds?: number;
  error?: string;
}

export interface EmailOtpVerifyParams {
  code: string;
  action: StepUpAction;
  amount: number;
  recipient?: string;
}

/**
 * Checks whether the current runtime environment supports WebAuthn APIs.
 * Safely handles SSR where window or navigator is undefined.
 */
export function isWebAuthnSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return (
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials !== "undefined" &&
    typeof navigator.credentials.get === "function"
  );
}

/**
 * Checks whether a platform authenticator (e.g. Touch ID, Face ID, Windows Hello)
 * is available on the client device.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) {
    return false;
  }

  if (
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !==
    "function"
  ) {
    return false;
  }

  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Helper to encode an ArrayBuffer to a base64url string.
 */
export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Helper to decode a base64url string to an ArrayBuffer.
 */
export function base64UrlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/**
 * Serializes a native PublicKeyCredential assertion into an AuthenticationResponseJSON payload
 * suitable for backend transmission and SimpleWebAuthn server verification.
 */
export function serializeAuthenticationAssertion(
  credential: PublicKeyCredential
): AuthenticationResponseJSON {
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type as "public-key",
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults
      ? credential.getClientExtensionResults()
      : {},
  };
}

/**
 * Requests a fresh, cryptographically secure challenge from the server
 * bound to the user and the specific transaction context.
 */
export async function requestStepUpChallenge(
  txContext: TransactionContext,
  endpoint = "/api/auth/passkey/step-up/options"
): Promise<StepUpChallengeResponse> {
  const url = new URL(endpoint, typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  url.searchParams.set("action", txContext.action);
  url.searchParams.set("amount", String(txContext.amount));
  if (txContext.recipient) {
    url.searchParams.set("recipient", txContext.recipient);
  }
  if (txContext.currency) {
    url.searchParams.set("currency", txContext.currency);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });

  if (!res.ok) {
    let errorMsg = `Server returned ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch {
      // ignore
    }
    throw new Error(errorMsg);
  }

  return await res.json();
}

/**
 * Prompts the user for biometric or hardware key assertion using navigator.credentials.get().
 */
export async function authenticateWithPasskey(
  options: PublicKeyCredentialRequestOptionsJSON
): Promise<AuthenticationResponseJSON> {
  if (!isWebAuthnSupported()) {
    throw new Error("WebAuthn is not supported in this browser");
  }

  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToBuffer(options.challenge),
    timeout: options.timeout || 60000,
    rpId: options.rpId,
    userVerification: options.userVerification || "required",
    allowCredentials: options.allowCredentials?.map((cred) => ({
      id: base64UrlToBuffer(cred.id),
      type: cred.type as "public-key",
      transports: cred.transports as AuthenticatorTransport[],
    })),
  };

  const credential = (await navigator.credentials.get({
    publicKey: publicKeyOptions,
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error("No credential was returned by the authenticator");
  }

  return serializeAuthenticationAssertion(credential);
}

/**
 * Submits the serialized assertion to the backend for cryptographic signature verification.
 * The backend issues a single-use stepUpToken upon verification.
 */
export async function verifyStepUpAssertion(
  assertion: AuthenticationResponseJSON,
  txContext: TransactionContext,
  endpoint = "/api/auth/passkey/step-up/verify"
): Promise<{ verified: boolean; stepUpToken: string; error?: string }> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      authenticationResponse: assertion,
      action: txContext.action,
      amount: txContext.amount,
      recipient: txContext.recipient,
      currency: txContext.currency,
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.verified || !data.stepUpToken) {
    throw new Error(data.error || "Step-up verification failed on server");
  }

  return {
    verified: true,
    stepUpToken: data.stepUpToken,
  };
}

/**
 * High-level orchestration for WebAuthn step-up authentication.
 */
export async function performWebAuthnStepUp(
  txContext: TransactionContext
): Promise<StepUpAuthResult> {
  if (!isWebAuthnSupported()) {
    return {
      success: false,
      type: "unsupported_browser",
      error: "WebAuthn is not supported on this browser or platform.",
    };
  }

  try {
    // 1. Obtain challenge
    const challengeData = await requestStepUpChallenge(txContext);

    // 2. Prompt user
    let assertion: AuthenticationResponseJSON;
    try {
      assertion = await authenticateWithPasskey(challengeData.options);
    } catch (authErr: any) {
      if (
        authErr.name === "NotAllowedError" ||
        authErr.message?.toLowerCase().includes("cancel") ||
        authErr.message?.toLowerCase().includes("not allowed")
      ) {
        return {
          success: false,
          type: "user_cancelled",
          error: "Biometric authentication was cancelled or timed out.",
        };
      }
      return {
        success: false,
        type: "authenticator_rejected",
        error: authErr.message || "Passkey authentication was rejected by the authenticator.",
      };
    }

    // 3. Verify assertion on trusted server
    const verification = await verifyStepUpAssertion(assertion, txContext);

    return {
      success: true,
      type: "success",
      stepUpToken: verification.stepUpToken,
      credentialId: assertion.id,
    };
  } catch (err: any) {
    const msg = err.message || "Step-up authentication failed.";
    if (msg.includes("expired")) {
      return { success: false, type: "challenge_expired", error: msg };
    }
    if (msg.includes("fetch") || msg.includes("network")) {
      return { success: false, type: "network_error", error: msg };
    }
    return {
      success: false,
      type: "verification_failed",
      error: msg,
    };
  }
}

/**
 * Requests an email OTP step-up fallback code for the transaction.
 */
export async function requestStepUpEmailOtp(
  params: EmailOtpRequestParams,
  endpoint = "/api/auth/step-up/email-otp/request"
): Promise<EmailOtpRequestResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        success: false,
        error: data.error || "Failed to send email verification code",
      };
    }

    return {
      success: true,
      maskedEmail: data.maskedEmail,
      expiresInSeconds: data.expiresInSeconds || 300,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Network error requesting verification code",
    };
  }
}

/**
 * Submits the email OTP code to the server to verify and receive the stepUpToken.
 */
export async function verifyStepUpEmailOtp(
  params: EmailOtpVerifyParams,
  endpoint = "/api/auth/step-up/email-otp/verify"
): Promise<StepUpAuthResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok || !data.verified || !data.stepUpToken) {
      return {
        success: false,
        type: "verification_failed",
        error: data.error || "Email verification code is invalid or expired",
      };
    }

    return {
      success: true,
      type: "success",
      stepUpToken: data.stepUpToken,
      usedFallback: true,
    };
  } catch (err: any) {
    return {
      success: false,
      type: "network_error",
      error: err.message || "Network error verifying code",
    };
  }
}
