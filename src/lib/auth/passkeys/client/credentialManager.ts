import {
  browserSupportsWebAuthn,
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/browser";
import {
  DEFAULT_PRF_SALT_STRING,
  PASSKEY_CHALLENGE_TTL_MS,
  PASSKEY_SESSION_STORAGE_KEY,
  type FrameWebAuthnStatus,
  type StoredPasskeyChallenge,
} from "../types";

/**
 * Checks whether the current browser supports WebAuthn APIs.
 */
export function isWebAuthnSupported(): boolean {
  if (typeof window === "undefined") return false;
  return browserSupportsWebAuthn();
}

/**
 * Checks whether the current browser supports WebAuthn conditional mediation (passkey autofill).
 */
export async function isConditionalMediationSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!browserSupportsWebAuthn()) return false;
  if (
    typeof window.PublicKeyCredential === "undefined" ||
    typeof window.PublicKeyCredential.isConditionalMediationAvailable !== "function"
  ) {
    return false;
  }
  try {
    return await window.PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

/**
 * Alias for isConditionalMediationSupported.
 */
export const isPasskeyAutofillSupported = isConditionalMediationSupported;

/**
 * Client-side browser wrapper around startRegistration from SimpleWebAuthn.
 */
export async function startPasskeyRegistration(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  return startRegistration({ optionsJSON: options });
}

/**
 * Client-side browser wrapper around startAuthentication from SimpleWebAuthn.
 */
export async function startPasskeyAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON,
  useBrowserAutofill = false,
): Promise<AuthenticationResponseJSON> {
  return startAuthentication({ optionsJSON: options, useBrowserAutofill });
}

/**
 * Converts a string or Uint8Array into a 32-byte salt buffer for the PRF extension.
 */
export function createPrfSalt(customSalt?: string | Uint8Array): Uint8Array {
  if (customSalt instanceof Uint8Array) {
    if (customSalt.length === 32) return customSalt;
    const buf = new Uint8Array(32);
    buf.set(customSalt.subarray(0, 32));
    return buf;
  }
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(customSalt || DEFAULT_PRF_SALT_STRING);
  const salt = new Uint8Array(32);
  salt.set(rawBytes.subarray(0, 32));
  return salt;
}

/**
 * Builds WebAuthn authentication extension input for PRF (Pseudo-Random Function).
 */
export function buildPrfAuthenticationExtension(salt?: Uint8Array | string): {
  prf: {
    eval: {
      first: Uint8Array;
      second?: Uint8Array;
    };
  };
} {
  const saltBuffer = createPrfSalt(salt);
  return {
    prf: {
      eval: {
        first: saltBuffer,
      },
    },
  };
}

/**
 * Stores a passkey ceremony challenge in sessionStorage with a timestamp and 5-minute expiration window.
 */
export function savePasskeyChallengeToSession(
  challenge: string,
  ceremonyType: "registration" | "authentication" | "step_up" = "authentication",
  ttlMs: number = PASSKEY_CHALLENGE_TTL_MS,
): StoredPasskeyChallenge | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  const now = Date.now();
  const entry: StoredPasskeyChallenge = {
    challenge,
    ceremonyType,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  try {
    window.sessionStorage.setItem(
      PASSKEY_SESSION_STORAGE_KEY,
      JSON.stringify(entry),
    );
    return entry;
  } catch (err) {
    console.warn("Failed to save passkey challenge to sessionStorage:", err);
    return null;
  }
}

/**
 * Retrieves the stored passkey challenge from sessionStorage.
 * Automatically invalidates and removes the challenge if it is older than 5 minutes.
 */
export function getValidPasskeyChallengeFromSession(
  expectedCeremonyType?: "registration" | "authentication" | "step_up",
): string | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;

  try {
    const raw = window.sessionStorage.getItem(PASSKEY_SESSION_STORAGE_KEY);
    if (!raw) return null;

    const parsed: StoredPasskeyChallenge = JSON.parse(raw);
    const now = Date.now();

    if (!parsed || !parsed.challenge || !parsed.expiresAt || now >= parsed.expiresAt) {
      clearPasskeyChallengeFromSession();
      return null;
    }

    if (expectedCeremonyType && parsed.ceremonyType !== expectedCeremonyType) {
      clearPasskeyChallengeFromSession();
      return null;
    }

    return parsed.challenge;
  } catch {
    clearPasskeyChallengeFromSession();
    return null;
  }
}

/**
 * Clears any cached passkey challenge from sessionStorage.
 */
export function clearPasskeyChallengeFromSession(): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(PASSKEY_SESSION_STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to remove passkey challenge from sessionStorage:", err);
  }
}

/**
 * Attaches beforeunload / unload event listener to clear passkey challenge from sessionStorage on tab/window close.
 */
export function setupPasskeyUnloadCleanup(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleUnload = () => {
    clearPasskeyChallengeFromSession();
  };

  window.addEventListener("beforeunload", handleUnload);
  window.addEventListener("pagehide", handleUnload);

  return () => {
    window.removeEventListener("beforeunload", handleUnload);
    window.removeEventListener("pagehide", handleUnload);
  };
}

function isCrossOriginParent(): boolean {
  if (typeof window === "undefined" || window.top === window.self) {
    return false;
  }
  try {
    void window.top?.location.href;
    return false;
  } catch {
    return true;
  }
}

function readPermissionsPolicy(feature: string): boolean | null {
  if (typeof document === "undefined") return null;
  const anyDocument = document as unknown as {
    permissionsPolicy?: { allowsFeature?: (f: string) => boolean };
    featurePolicy?: { allowsFeature?: (f: string) => boolean };
  };
  try {
    if (anyDocument.permissionsPolicy?.allowsFeature) {
      return anyDocument.permissionsPolicy.allowsFeature(feature);
    }
    if (anyDocument.featurePolicy?.allowsFeature) {
      return anyDocument.featurePolicy.allowsFeature(feature);
    }
  } catch {
    return null;
  }
  return null;
}

export function getFrameWebAuthnStatus(): FrameWebAuthnStatus {
  const isEmbedded =
    typeof window !== "undefined" && window.self !== window.top;
  const isCrossOrigin = isEmbedded && isCrossOriginParent();
  const permissionDelegated = isEmbedded
    ? readPermissionsPolicy("publickey-credentials-get")
    : true;

  const shouldBlockPasskeys =
    isEmbedded && (isCrossOrigin || permissionDelegated === false);

  return {
    isEmbedded,
    isCrossOrigin,
    permissionDelegated,
    shouldBlockPasskeys,
  };
}

const WEBAUTHN_FRAME_ERROR_PATTERNS = [
  /relying party id/i,
  /not a valid domain suffix/i,
  /publickey-credentials-get/i,
];

function looksLikeWebAuthnFrameError(reason: unknown): boolean {
  if (!reason) return false;
  const name = (reason as { name?: string }).name;
  const message = (reason as { message?: string }).message ?? String(reason);
  if (
    name !== "SecurityError" &&
    !WEBAUTHN_FRAME_ERROR_PATTERNS.some((p) => p.test(message))
  ) {
    return false;
  }
  return (
    WEBAUTHN_FRAME_ERROR_PATTERNS.some((p) => p.test(message)) ||
    name === "SecurityError"
  );
}

export function installWebAuthnFrameGuard(onBlocked: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: PromiseRejectionEvent) => {
    if (looksLikeWebAuthnFrameError(event.reason)) {
      event.preventDefault();
      onBlocked();
    }
  };

  window.addEventListener("unhandledrejection", handler);

  let originalGet: typeof navigator.credentials.get | undefined;
  let originalCreate: typeof navigator.credentials.create | undefined;

  if (navigator.credentials) {
    originalGet = navigator.credentials.get?.bind(navigator.credentials);
    originalCreate = navigator.credentials.create?.bind(navigator.credentials);

    if (originalGet) {
      navigator.credentials.get = async function (options) {
        const status = getFrameWebAuthnStatus();
        if (status.shouldBlockPasskeys) {
          throw new DOMException(
            "The Relying Party ID is not a valid domain suffix.",
            "SecurityError",
          );
        }
        return originalGet!(options);
      };
    }

    if (originalCreate) {
      navigator.credentials.create = async function (options) {
        const status = getFrameWebAuthnStatus();
        if (status.shouldBlockPasskeys) {
          throw new DOMException(
            "The Relying Party ID is not a valid domain suffix.",
            "SecurityError",
          );
        }
        return originalCreate!(options);
      };
    }
  }

  return () => {
    window.removeEventListener("unhandledrejection", handler);
    if (navigator.credentials) {
      if (originalGet) navigator.credentials.get = originalGet;
      if (originalCreate) navigator.credentials.create = originalCreate;
    }
  };
}
