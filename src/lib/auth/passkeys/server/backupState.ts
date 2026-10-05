import type { AuthenticatorFlags } from "../types";

/**
 * Extracts and parses authenticator flags from a raw WebAuthn flags byte or authData buffer.
 */
export function parseAuthenticatorFlags(
  flagsByteOrAuthData: number | Uint8Array | Buffer,
): AuthenticatorFlags {
  let flagsByte: number;

  if (typeof flagsByteOrAuthData === "number") {
    flagsByte = flagsByteOrAuthData;
  } else if (flagsByteOrAuthData.length >= 33) {
    // In WebAuthn authData, byte 32 is the flags byte (32 bytes RP ID hash + 1 byte flags)
    flagsByte = flagsByteOrAuthData[32];
  } else if (flagsByteOrAuthData.length > 0) {
    flagsByte = flagsByteOrAuthData[0];
  } else {
    flagsByte = 0;
  }

  const userPresent = (flagsByte & 0x01) !== 0;
  const userVerified = (flagsByte & 0x04) !== 0;
  const backupEligible = (flagsByte & 0x08) !== 0;
  const backedUp = (flagsByte & 0x10) !== 0;
  const attestedCredentialData = (flagsByte & 0x40) !== 0;
  const extensionData = (flagsByte & 0x80) !== 0;

  const deviceType: "single_device" | "multi_device" = backupEligible
    ? "multi_device"
    : "single_device";

  let riskLevel: "low" | "medium" | "elevated" = "low";
  let securityRecommendation: string | undefined;

  if (!backupEligible && !backedUp) {
    riskLevel = "medium";
    securityRecommendation =
      "This passkey is bound to a single physical device (e.g. YubiKey). We recommend creating an Emergency Kit or registering a backup passkey.";
  } else if (backupEligible && !backedUp) {
    riskLevel = "medium";
    securityRecommendation =
      "Passkey is sync-capable but not yet synced to your cloud keychain. Ensure cloud sync is enabled in your password manager.";
  } else {
    riskLevel = "low";
  }

  return {
    userPresent,
    userVerified,
    backupEligible,
    backedUp,
    attestedCredentialData,
    extensionData,
    deviceType,
    riskLevel,
    securityRecommendation,
  };
}

/**
 * Validates whether a passkey credential requires step-up re-authentication or backup intervention.
 */
export function evaluateCredentialBackupStatus(credential: {
  backedUp: boolean;
  deviceType?: string;
  counter?: bigint | number;
  lastUsedAt?: Date | string | null;
}): {
  isSynced: boolean;
  isSingleDevice: boolean;
  backupHealth: "healthy" | "unbacked_single_device" | "sync_pending";
  description: string;
} {
  const isSynced = credential.backedUp === true;
  const isSingleDevice =
    credential.deviceType === "single_device" ||
    credential.deviceType === "singleDevice";

  if (isSingleDevice) {
    return {
      isSynced: false,
      isSingleDevice: true,
      backupHealth: "unbacked_single_device",
      description: "Hardware-bound single device key (No cloud backup).",
    };
  }

  if (isSynced) {
    return {
      isSynced: true,
      isSingleDevice: false,
      backupHealth: "healthy",
      description: "Cloud-backed multi-device passkey (iCloud / Google / 1Password synced).",
    };
  }

  return {
    isSynced: false,
    isSingleDevice: false,
    backupHealth: "sync_pending",
    description: "Sync-eligible passkey with pending cloud backup.",
  };
}
