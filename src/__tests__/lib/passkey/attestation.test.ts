import {
  verifyPackedAttestation,
  verifyAndroidKeyAttestation,
  verifyNoneAttestation,
} from "@/lib/passkey/attestation";

// Mock crypto.subtle for existing behavior tests
Object.defineProperty(global, "crypto", {
  value: {
    subtle: {
      generateKey: jest.fn().mockResolvedValue({
        publicKey: {} as CryptoKey,
      }),
      verify: jest.fn().mockResolvedValue(true),
    },
  },
});

describe("Attestation Verification", () => {
  const dummyAuthData = new Uint8Array([1, 2, 3]);
  const dummyClientDataHash = new Uint8Array([4, 5, 6]);

  beforeEach(() => {
    jest.clearAllMocks();
    (global.crypto.subtle.verify as jest.Mock).mockResolvedValue(true);
    (global.crypto.subtle.generateKey as jest.Mock).mockResolvedValue({
      publicKey: {} as CryptoKey,
    });
  });

  describe("verifyNoneAttestation (Firefox Android support)", () => {
    it("should return true for completely empty attStmt (Firefox Android none attestation)", () => {
      const result = verifyNoneAttestation({});
      expect(result.verified).toBe(true);
    });

    it("should return false if attStmt contains fields", () => {
      const result = verifyNoneAttestation({ someField: "value" });
      expect(result.verified).toBe(false);
    });

    it("should return false for invalid attStmt types", () => {
      expect(verifyNoneAttestation(null as any).verified).toBe(false);
      expect(verifyNoneAttestation(undefined as any).verified).toBe(false);
      expect(verifyNoneAttestation("string" as any).verified).toBe(false);
    });
  });

  describe("verifyPackedAttestation", () => {
    it("should reject safely if sig is missing", async () => {
      const result = await verifyPackedAttestation(
        { x5c: [new Uint8Array([1])] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(false);
    });

    it("should reject safely if x5c is missing (self-attestation currently unsupported)", async () => {
      const result = await verifyPackedAttestation(
        { sig: new Uint8Array([1]) },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(false);
    });

    it("should verify successfully with valid sig and x5c (Chrome/Safari behavior)", async () => {
      const result = await verifyPackedAttestation(
        { sig: new Uint8Array([1]), x5c: [new Uint8Array([2])] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(true);
      expect(global.crypto.subtle.verify).toHaveBeenCalled();
    });

    it("should reject if leaf cert is missing from x5c", async () => {
      const result = await verifyPackedAttestation(
        { sig: new Uint8Array([1]), x5c: [undefined as any] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(false);
    });

    it("should return false for invalid attStmt types", async () => {
      expect(
        (
          await verifyPackedAttestation(
            null as any,
            dummyAuthData,
            dummyClientDataHash,
          )
        ).verified,
      ).toBe(false);
    });
  });

  describe("verifyAndroidKeyAttestation", () => {
    it("should reject safely if sig is missing", async () => {
      const result = await verifyAndroidKeyAttestation(
        { x5c: [new Uint8Array([1])] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(false);
    });

    it("should reject safely if x5c is missing or empty", async () => {
      const result1 = await verifyAndroidKeyAttestation(
        { sig: new Uint8Array([1]) },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result1.verified).toBe(false);

      const result2 = await verifyAndroidKeyAttestation(
        { sig: new Uint8Array([1]), x5c: [] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result2.verified).toBe(false);
    });

    it("should verify successfully with valid sig and x5c (Chrome/Safari behavior)", async () => {
      const result = await verifyAndroidKeyAttestation(
        { sig: new Uint8Array([1]), x5c: [new Uint8Array([2])] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(true);
      expect(global.crypto.subtle.verify).toHaveBeenCalled();
    });

    it("should reject if leaf cert is missing from x5c", async () => {
      const result = await verifyAndroidKeyAttestation(
        { sig: new Uint8Array([1]), x5c: [undefined as any] },
        dummyAuthData,
        dummyClientDataHash,
      );
      expect(result.verified).toBe(false);
    });

    it("should return false for invalid attStmt types", async () => {
      expect(
        (
          await verifyAndroidKeyAttestation(
            null as any,
            dummyAuthData,
            dummyClientDataHash,
          )
        ).verified,
      ).toBe(false);
    });
  });
});
