/**
 * Helpers for dealing with WebAuthn/passkey authentication when WorkSphere is
 * rendered inside an iframe (e.g. a Vercel preview embed, a partner dashboard,
 * or a documentation site).
 *
 * Background: `navigator.credentials.get()` / `.create()` are gated by the
 * `publickey-credentials-get` / `publickey-credentials-create` Permissions
 * Policy features. When a page is embedded cross-origin, the browser will
 * only allow a WebAuthn ceremony if the *top-level* document explicitly
 * delegates that permission (via a `Permissions-Policy` response header or an
 * `allow="publickey-credentials-get"` attribute on the `<iframe>` tag).
 * WorkSphere has no control over a third-party page that embeds it, so it
 * cannot force that delegation to happen — the correct fix on our side is to
 * detect the situation up front and degrade gracefully instead of letting the
 * user hit a raw `SecurityError` DOMException.
 */

export interface FrameWebAuthnStatus {
  /** True if this document is rendered inside any iframe. */
  isEmbedded: boolean;
  /** True if the embedding parent is on a different origin than this page. */
  isCrossOrigin: boolean;
  /**
   * Whether the `publickey-credentials-get` permission has been delegated to
   * this frame. `null` means the browser doesn't expose the Permissions
   * Policy introspection API, so we can't know ahead of time.
   */
  permissionDelegated: boolean | null;
  /** Convenience flag: should we warn the user / hide passkey UI? */
  shouldBlockPasskeys: boolean;
}

function isCrossOriginParent(): boolean {
  if (typeof window === "undefined" || window.top === window.self) {
    return false;
  }
  try {
    // Accessing a cross-origin window's location throws a SecurityError.
    // Same-origin parents allow this read without throwing.
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
    // Feature detection failed; treat as unknown rather than blocking.
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

  // Only warn when we're confident passkeys will fail: embedded, and either
  // definitely cross-origin or definitely lacking permission delegation.
  // If we can't tell (permissionDelegated === null) we stay quiet rather than
  // showing a false-positive warning for legitimate same-site embeds.
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

/**
 * Installs a global `unhandledrejection` listener that catches the specific
 * DOMException WebAuthn throws when it can't create/verify a challenge in a
 * cross-origin iframe, swallows it (so it doesn't surface as an unhandled
 * console error / broken UI), and invokes `onBlocked` so the caller can show
 * a friendly message instead. Returns a cleanup function.
 */
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
