import type { Prisma } from "@prisma/client";

export const RP_NAME = "WorkSphere";
export const DEFAULT_PRF_SALT_STRING = "WorkSphere-Passkey-Notes-PRF-Salt-v1";
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_SESSION_STORAGE_KEY = "worksphere_passkey_challenge";
export const KEY_EXPIRY_DAYS = 90;
export const KEY_ROTATION_INTERVAL_DAYS = 90;

export const PASSKEY_OTP_ACTIONS = ["rotate", "rename", "revoke"] as const;
export type PasskeyOtpAction = (typeof PASSKEY_OTP_ACTIONS)[number];

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type AttestationFormat =
  | "packed"
  | "android-key"
  | "android-safetynet"
  | "fido-u2f"
  | "none";

export interface AttestationVerificationResult {
  verified: boolean;
  attestationFormat: AttestationFormat;
  keyExpiryDate: Date;
  trustPath?: string[];
}

export type VerifiedRegistration = {
  challengeId: string;
  credential: {
    credentialId: string;
    publicKey: Prisma.PasskeyCredentialUncheckedCreateInput["publicKey"];
    counter: bigint;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
    aaguid: string | null;
    expiresAt: Date;
  };
};

export type RegistrationResult =
  | { ok: true; registration: VerifiedRegistration }
  | { ok: false; status: 400; error: string };

export interface AuthenticatorFlags {
  userPresent: boolean;
  userVerified: boolean;
  backupEligible: boolean; // BE flag (syncable across devices)
  backedUp: boolean; // BS flag (currently stored in cloud keychain)
  attestedCredentialData: boolean;
  extensionData: boolean;
  deviceType: "single_device" | "multi_device";
  riskLevel: "low" | "medium" | "elevated";
  securityRecommendation?: string;
}

export interface StoredPasskeyChallenge {
  challenge: string;
  ceremonyType: "registration" | "authentication" | "step_up";
  createdAt: number;
  expiresAt: number;
}

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

export type OtpVerification =
  | { ok: true; otpId: string }
  | { ok: false; reason: "missing" | "expired" | "locked" | "invalid" };

export interface RotationStatus {
  credentialId: string;
  name: string;
  expiresAt: Date;
  isExpired: boolean;
  daysUntilExpiry: number;
  needsRotation: boolean;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface Share {
  x: number;
  y: Uint8Array;
}

export interface EncryptedShare {
  x: number;
  iv: string; // base64
  ciphertext: string; // base64
}

export interface EmergencyKitPayload {
  version: 1;
  createdAt: string; // ISO timestamp
  share: EncryptedShare;
  label?: string;
}

export type WebAuthnVerifyInput = {
  /** Browser origin from clientDataJSON (or request Origin header). */
  origin: string;
  /** Expected challenge previously issued to the client. */
  expectedChallenge: string;
  /** Challenge echoed back inside clientDataJSON. */
  challenge: string;
  /** Optional override; otherwise WEBAUTHN_RP_ID / derived from origin. */
  rpId?: string;
  /** User-Agent header from incoming request. */
  userAgent?: string | null;
};

export type WebAuthnVerifyResult =
  | { ok: true; rpId: string }
  | { ok: false; error: "Invalid WebAuthn challenge signature" };
