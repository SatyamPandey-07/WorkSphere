import {
  encryptPayload,
  decryptPayload,
  setSessionEncryptionSecret,
  clearSessionEncryptionKey,
  deriveKey,
} from "@/lib/security/clientEncryption";
import { DraftStore, BookingDraft } from "@/worker/bookingSync/DraftStore";

describe("Client-side Offline Booking Draft Encryption (#10010)", () => {
  const sampleReservation = {
    guestName: "Alice Nomad",
    seatId: "desk-quiet-42",
    dates: ["2026-12-01", "2026-12-02"],
    cardDetails: { last4: "4242", token: "tok_secure_123" },
    status: "PENDING",
  };

  afterEach(() => {
    clearSessionEncryptionKey();
  });

  describe("clientEncryption utility", () => {
    it("successfully encrypts and decrypts a booking payload round-trip", async () => {
      const encrypted = await encryptPayload(sampleReservation);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.salt).toBeDefined();
      expect(typeof encrypted.ciphertext).toBe("string");
      expect(encrypted.ciphertext).not.toContain("Alice Nomad");

      const decrypted = await decryptPayload<typeof sampleReservation>(encrypted);
      expect(decrypted).toEqual(sampleReservation);
    });

    it("derives distinct keys from different session secrets", async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key1 = await deriveKey("user-secret-1", salt);
      const key2 = await deriveKey("user-secret-2", salt);

      const payload = { sensitive: "secret data" };
      const encrypted = await encryptPayload(payload, "user-secret-1");

      await expect(decryptPayload(encrypted, "user-secret-2")).rejects.toThrow(
        /Failed to decrypt booking payload/,
      );
    });

    it("wipes session credentials upon logout / clearSessionEncryptionKey", async () => {
      setSessionEncryptionSecret("temporary-session-token");
      clearSessionEncryptionKey();

      // After clearing, encrypting uses fallback/clean state without stale session secret
      const encrypted = await encryptPayload({ test: 123 });
      const decrypted = await decryptPayload(encrypted);
      expect(decrypted).toEqual({ test: 123 });
    });

    it("gracefully throws recoverable error on corrupt ciphertext", async () => {
      const encrypted = await encryptPayload(sampleReservation);
      // Corrupt the ciphertext
      const corruptEncrypted = {
        ...encrypted,
        ciphertext: btoa("tampered-invalid-ciphertext-stream"),
      };

      await expect(decryptPayload(corruptEncrypted)).rejects.toThrow(
        /Failed to decrypt booking payload/,
      );
    });
  });

  describe("DraftStore Transparent Encryption", () => {
    let draftStore: DraftStore;

    beforeEach(async () => {
      draftStore = new DraftStore();
      await draftStore.clearAll();
    });

    afterEach(async () => {
      await draftStore.clearAll();
    });

    it("transparently encrypts drafts and verifies raw reservation data is never in plaintext", async () => {
      const draft: BookingDraft = {
        id: "draft-secret-101",
        venueId: "venue-sf-hub",
        userId: "user-alice",
        payload: sampleReservation,
        timestamp: Date.now(),
      };

      await draftStore.saveDraft(draft);

      // Verify the storage representation is encrypted and raw payload stripped
      const rawStored = await draftStore.getRawDraft("draft-secret-101");
      expect(rawStored).toBeDefined();
      expect(rawStored?.isEncrypted).toBe(true);
      expect(rawStored?.encryptedPayload).toBeDefined();
      expect(rawStored?.payload).toEqual({}); // Plaintext stripped!

      // Verify getDraft transparently decrypts and returns full payload
      const retrieved = await draftStore.getDraft("draft-secret-101");
      expect(retrieved).toBeDefined();
      expect(retrieved?.payload).toEqual(sampleReservation);
      expect((retrieved?.payload as any).guestName).toBe("Alice Nomad");
    });

    it("transparently decrypts all drafts in getAllDrafts()", async () => {
      await draftStore.createDraft({
        id: "draft-batch-1",
        venueId: "venue-1",
        userId: "user-1",
        payload: { reservationNumber: "RES-001" },
      });
      await draftStore.createDraft({
        id: "draft-batch-2",
        venueId: "venue-2",
        userId: "user-2",
        payload: { reservationNumber: "RES-002" },
      });

      const all = await draftStore.getAllDrafts();
      expect(all.length).toBe(2);
      expect(all.find((d) => d.id === "draft-batch-1")?.payload).toEqual({
        reservationNumber: "RES-001",
      });
      expect(all.find((d) => d.id === "draft-batch-2")?.payload).toEqual({
        reservationNumber: "RES-002",
      });
    });

    it("handles recovery gracefully when a stored draft contains corrupt ciphertext", async () => {
      // Store a draft directly with corrupted ciphertext
      const corruptDraft: BookingDraft = {
        id: "draft-corrupt",
        venueId: "venue-1",
        userId: "user-1",
        payload: {},
        isEncrypted: true,
        encryptedPayload: {
          ciphertext: btoa("corrupt-bytes"),
          iv: btoa("123456789012"),
          salt: btoa("1234567890123456"),
        },
        timestamp: Date.now(),
      };

      if ((draftStore as any).db) {
        const tx = (draftStore as any).db.transaction("booking_drafts", "readwrite");
        const store = tx.objectStore("booking_drafts");
        await new Promise((res) => {
          const req = store.put(corruptDraft);
          req.onsuccess = () => res(req.result);
        });
      } else {
        (draftStore as any).memoryFallback.set("draft-corrupt", corruptDraft);
      }

      const retrieved = await draftStore.getDraft("draft-corrupt");
      expect(retrieved).toBeDefined();
      expect((retrieved?.payload as any).__corrupted).toBe(true);
    });
  });
});
