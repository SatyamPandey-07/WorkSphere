import {
  parseAuthenticatorFlags,
  evaluateCredentialBackupStatus,
  FLAG_UP,
  FLAG_UV,
  FLAG_BE,
  FLAG_BS,
  FLAG_AT,
  FLAG_ED,
} from "@/lib/auth/passkeys/server/backupState";

describe("Passkey Authenticator Flags and Backup State", () => {
  describe("parseAuthenticatorFlags", () => {
    it("parses direct numeric byte inputs with individual bitflags", () => {
      // 0x01: User Present only
      const upOnly = parseAuthenticatorFlags(FLAG_UP);
      expect(upOnly.userPresent).toBe(true);
      expect(upOnly.userVerified).toBe(false);
      expect(upOnly.backupEligible).toBe(false);
      expect(upOnly.backedUp).toBe(false);
      expect(upOnly.deviceType).toBe("single_device");
      expect(upOnly.riskLevel).toBe("medium");

      // 0x05: User Present (0x01) + User Verified (0x04)
      const uv = parseAuthenticatorFlags(FLAG_UP | FLAG_UV);
      expect(uv.userPresent).toBe(true);
      expect(uv.userVerified).toBe(true);
      expect(uv.backupEligible).toBe(false);

      // 0x1D: UP (0x01) + UV (0x04) + BE (0x08) + BS (0x10) -> Cloud synced passkey
      const synced = parseAuthenticatorFlags(FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS);
      expect(synced.userPresent).toBe(true);
      expect(synced.userVerified).toBe(true);
      expect(synced.backupEligible).toBe(true);
      expect(synced.backedUp).toBe(true);
      expect(synced.deviceType).toBe("multi_device");
      expect(synced.riskLevel).toBe("low");
      expect(synced.securityRecommendation).toBeUndefined();

      // Attested credential data (0x40) and extension data (0x80)
      const full = parseAuthenticatorFlags(
        FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT | FLAG_ED,
      );
      expect(full.attestedCredentialData).toBe(true);
      expect(full.extensionData).toBe(true);
    });

    it("extracts flag byte from index 32 in standard 37-byte WebAuthn authData buffer", () => {
      const authData = new Uint8Array(37);
      // Fill 32-byte RP ID hash
      authData.fill(0xAA, 0, 32);
      // Byte 32: Flags (UP | UV | BE)
      authData[32] = FLAG_UP | FLAG_UV | FLAG_BE;
      // Bytes 33-36: Sign Counter (0)
      authData.fill(0x00, 33, 37);

      const parsed = parseAuthenticatorFlags(authData);
      expect(parsed.userPresent).toBe(true);
      expect(parsed.userVerified).toBe(true);
      expect(parsed.backupEligible).toBe(true);
      expect(parsed.backedUp).toBe(false);
      expect(parsed.deviceType).toBe("multi_device");
      expect(parsed.riskLevel).toBe("medium");
      expect(parsed.securityRecommendation).toContain("Passkey is sync-capable but not yet synced");
    });

    it("handles short, empty, or truncated buffer inputs gracefully", () => {
      // 1-byte buffer (direct flag byte)
      const singleByte = new Uint8Array([FLAG_UP | FLAG_UV]);
      const parsedSingle = parseAuthenticatorFlags(singleByte);
      expect(parsedSingle.userPresent).toBe(true);
      expect(parsedSingle.userVerified).toBe(true);

      // Empty buffer -> all flags false
      const empty = parseAuthenticatorFlags(new Uint8Array(0));
      expect(empty.userPresent).toBe(false);
      expect(empty.userVerified).toBe(false);
      expect(empty.backupEligible).toBe(false);
      expect(empty.backedUp).toBe(false);
      expect(empty.riskLevel).toBe("medium");
    });

    it("provides specific security recommendations for single physical device keys (YubiKey)", () => {
      const singleDeviceKey = parseAuthenticatorFlags(FLAG_UP | FLAG_UV);
      expect(singleDeviceKey.deviceType).toBe("single_device");
      expect(singleDeviceKey.riskLevel).toBe("medium");
      expect(singleDeviceKey.securityRecommendation).toContain(
        "This passkey is bound to a single physical device (e.g. YubiKey)",
      );
    });
  });

  describe("evaluateCredentialBackupStatus", () => {
    it("identifies single device keys as unbacked_single_device", () => {
      const result = evaluateCredentialBackupStatus({
        backedUp: false,
        deviceType: "single_device",
      });

      expect(result.isSingleDevice).toBe(true);
      expect(result.isSynced).toBe(false);
      expect(result.backupHealth).toBe("unbacked_single_device");
      expect(result.description).toContain("Hardware-bound single device key");
    });

    it("identifies cloud-backed passkeys as healthy", () => {
      const result = evaluateCredentialBackupStatus({
        backedUp: true,
        deviceType: "multi_device",
      });

      expect(result.isSingleDevice).toBe(false);
      expect(result.isSynced).toBe(true);
      expect(result.backupHealth).toBe("healthy");
      expect(result.description).toContain("Cloud-backed multi-device passkey");
    });

    it("identifies sync-capable passkeys awaiting cloud upload as sync_pending", () => {
      const result = evaluateCredentialBackupStatus({
        backedUp: false,
        deviceType: "multi_device",
      });

      expect(result.isSingleDevice).toBe(false);
      expect(result.isSynced).toBe(false);
      expect(result.backupHealth).toBe("sync_pending");
      expect(result.description).toContain("Sync-eligible passkey with pending cloud backup");
    });
  });
});
