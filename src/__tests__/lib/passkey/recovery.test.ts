import {
  splitSecret,
  recoverSecret,
  encryptShare,
  decryptShare,
} from "@/lib/passkey/recovery";
import crypto from "crypto";

// Polyfill for crypto in Jest if necessary, though modern Node has it
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      subtle: crypto.webcrypto.subtle,
      getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto),
    },
  });
}
if (!globalThis.btoa) {
  globalThis.btoa = (str: string) =>
    Buffer.from(str, "binary").toString("base64");
  globalThis.atob = (str: string) =>
    Buffer.from(str, "base64").toString("binary");
}

describe("Shamir's Secret Sharing (2-of-3)", () => {
  it("should split and recover a secret", () => {
    const originalSecret = new Uint8Array([10, 20, 30, 255, 0, 100]);

    // Split into 3 shares
    const shares = splitSecret(originalSecret);
    expect(shares).toHaveLength(3);

    // Recover using share 1 and 2
    const recovered12 = recoverSecret(shares[0], shares[1]);
    expect(recovered12).toEqual(originalSecret);

    // Recover using share 2 and 3
    const recovered23 = recoverSecret(shares[1], shares[2]);
    expect(recovered23).toEqual(originalSecret);

    // Recover using share 1 and 3
    const recovered13 = recoverSecret(shares[0], shares[2]);
    expect(recovered13).toEqual(originalSecret);
  });

  it("should encrypt and decrypt shares using AES-GCM", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const share = { x: 1, y: new Uint8Array([1, 2, 3, 4, 5]) };

    const encrypted = await encryptShare(share, key);
    expect(encrypted.x).toBe(1);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.ciphertext).toBeDefined();

    const decrypted = await decryptShare(encrypted, key);
    expect(decrypted.x).toBe(1);
    expect(decrypted.y).toEqual(share.y);
  });
});
