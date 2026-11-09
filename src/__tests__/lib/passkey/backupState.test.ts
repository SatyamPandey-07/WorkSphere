import {
  parseAuthenticatorFlags,
  evaluateCredentialBackupStatus,
} from "@/lib/passkey/backupState";

describe("WebAuthn Authenticator Flags & Backup State Parser", () => {
  describe("parseAuthenticatorFlags", () => {
    it("parses raw flags byte correctly for single-device hardware key with user presence and verification", () => {
      // 0x01 (UP) | 0x04 (UV) = 0x05
      const flags = parseAuthenticatorFlags(0x05);
      expect(flags.userPresent).toBe(true);
      expect(flags.userVerified).toBe(true);
      expect(flags.backupEligible).toBe(false);
      expect(flags.backedUp).toBe(false);
      expect(flags.deviceType).toBe("single_device");
      expect(flags.riskLevel).toBe("medium");
      expect(flags.securityRecommendation).toContain("single physical device");
    });

    it("parses multi-device cloud synced passkey flags correctly (UP + UV + BE + BS)", () => {
      // 0x01 (UP) | 0x04 (UV) | 0x08 (BE) | 0x10 (BS) = 0x1d (29)
      const flags = parseAuthenticatorFlags(0x1d);
      expect(flags.userPresent).toBe(true);
      expect(flags.userVerified).toBe(true);
      expect(flags.backupEligible).toBe(true);
      expect(flags.backedUp).toBe(true);
      expect(flags.deviceType).toBe("multi_device");
      expect(flags.riskLevel).toBe("low");
      expect(flags.securityRecommendation).toBeUndefined();
    });

    it("detects sync-eligible but pending backup passkey (BE=true, BS=false)", () => {
      // 0x01 (UP) | 0x04 (UV) | 0x08 (BE) = 0x0d (13)
      const flags = parseAuthenticatorFlags(0x0d);
      expect(flags.backupEligible).toBe(true);
      expect(flags.backedUp).toBe(false);
      expect(flags.riskLevel).toBe("medium");
      expect(flags.securityRecommendation).toContain("cloud sync");
    });

    it("extracts flags byte from 37-byte WebAuthn authData buffer at byte 32", () => {
      // 32 bytes RP ID hash + 1 byte flags (0x1d) + 4 bytes counter
      const authData = new Uint8Array(37);
      authData[32] = 0x1d; // UP | UV | BE | BS
      const flags = parseAuthenticatorFlags(authData);
      expect(flags.userPresent).toBe(true);
      expect(flags.userVerified).toBe(true);
      expect(flags.backupEligible).toBe(true);
      expect(flags.backedUp).toBe(true);
    });
  });

  describe("evaluateCredentialBackupStatus", () => {
    it("evaluates healthy multi-device backed up passkey", () => {
      const status = evaluateCredentialBackupStatus({
        backedUp: true,
        deviceType: "multiDevice",
      });
      expect(status.isSynced).toBe(true);
      expect(status.isSingleDevice).toBe(false);
      expect(status.backupHealth).toBe("healthy");
      expect(status.description).toContain("Cloud-backed");
    });

    it("evaluates hardware-bound single device key", () => {
      const status = evaluateCredentialBackupStatus({
        backedUp: false,
        deviceType: "single_device",
      });
      expect(status.isSynced).toBe(false);
      expect(status.isSingleDevice).toBe(true);
      expect(status.backupHealth).toBe("unbacked_single_device");
      expect(status.description).toContain("Hardware-bound");
    });

    it("evaluates sync pending passkey", () => {
      const status = evaluateCredentialBackupStatus({
        backedUp: false,
        deviceType: "multi_device",
      });
      expect(status.isSynced).toBe(false);
      expect(status.isSingleDevice).toBe(false);
      expect(status.backupHealth).toBe("sync_pending");
    });
  });
});
