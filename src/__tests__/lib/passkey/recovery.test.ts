import {
  splitSecret,
  recoverSecret,
  encryptShare,
  decryptShare,
  buildEmergencyKitPayload,
  generateRecoveryQRCodeSVG,
  generateEmergencyKitPDF,
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

  it("recovers original secret with reversed share order (2, 1)", () => {
    const secret = new Uint8Array([128, 64, 32, 16, 8]);
    const [s1, s2] = splitSecret(secret);

    const recovered = recoverSecret(s2, s1);
    expect(recovered).toEqual(secret);
  });

  it("works for a single-byte secret", () => {
    const secret = new Uint8Array([0xff]);
    const [s1, _s2, s3] = splitSecret(secret);
    expect(recoverSecret(s1, s3)).toEqual(secret);
  });

  it("works for an all-zeros secret", () => {
    const secret = new Uint8Array(16);
    const [s1, s2] = splitSecret(secret);
    expect(recoverSecret(s1, s2)).toEqual(secret);
  });

  it("works for large (256 byte) secrets", () => {
    const secret = new Uint8Array(256);
    for (let i = 0; i < 256; i++) secret[i] = i;
    const [s1, _s2, s3] = splitSecret(secret);
    expect(recoverSecret(s1, s3)).toEqual(secret);
  });

  it("assigns correct x coordinates (1, 2, 3)", () => {
    const secret = new Uint8Array([42, 99]);
    const shares = splitSecret(secret);
    expect(shares[0].x).toBe(1);
    expect(shares[1].x).toBe(2);
    expect(shares[2].x).toBe(3);
  });

  it("throws when shares have the same x coordinate", () => {
    const secret = new Uint8Array([1, 2, 3]);
    const [s1] = splitSecret(secret);
    const dup = { x: s1.x, y: new Uint8Array(s1.y) };

    expect(() => recoverSecret(s1, dup)).toThrow(
      "Shares must have different X coordinates",
    );
  });

  it("throws when share lengths differ", () => {
    const share1 = { x: 1, y: new Uint8Array([1, 2, 3]) };
    const share2 = { x: 2, y: new Uint8Array([4, 5]) };

    expect(() => recoverSecret(share1, share2)).toThrow(
      "Share lengths must match",
    );
  });
});

describe("AES-GCM share encryption edge cases", () => {
  it("decryption with wrong key fails", async () => {
    const secret = new Uint8Array([99, 88, 77]);
    const [share] = splitSecret(secret);
    const rightKey = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const wrongKey = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const encrypted = await encryptShare(share, rightKey);
    await expect(decryptShare(encrypted, wrongKey)).rejects.toThrow();
  });

  it("encrypted share fields are base64 strings", async () => {
    const secret = new Uint8Array([1, 2, 3]);
    const [share] = splitSecret(secret);
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const enc = await encryptShare(share, key);
    const b64Re = /^[A-Za-z0-9+/=]+$/;
    expect(enc.iv).toMatch(b64Re);
    expect(enc.ciphertext).toMatch(b64Re);
  });

  it("full round-trip: split → encrypt → decrypt → recover", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const secret = new Uint8Array([5, 10, 15, 20, 25]);
    const [s1, s2, _s3] = splitSecret(secret);

    const enc1 = await encryptShare(s1, key);
    const enc2 = await encryptShare(s2, key);

    const dec1 = await decryptShare(enc1, key);
    const dec2 = await decryptShare(enc2, key);

    const recovered = recoverSecret(dec1, dec2);
    expect(recovered).toEqual(secret);
  });
});

describe("Emergency kit QR export (#1556)", () => {
  it("builds a kit payload that only contains the encrypted share, never raw key material", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const share = { x: 1, y: new Uint8Array([9, 8, 7, 6]) };
    const encrypted = await encryptShare(share, key);

    const payload = buildEmergencyKitPayload(encrypted, "Work laptop");

    expect(payload.version).toBe(1);
    expect(payload.label).toBe("Work laptop");
    expect(payload.share).toEqual(encrypted);
    expect(typeof payload.createdAt).toBe("string");

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('"y":');
    expect(serialized).toContain(encrypted.ciphertext);
  });

  it("generates a valid SVG string for a given payload", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const share = { x: 2, y: new Uint8Array([1, 1, 1]) };
    const encrypted = await encryptShare(share, key);
    const payload = buildEmergencyKitPayload(encrypted);

    const svg = generateRecoveryQRCodeSVG(payload, 200);

    expect(svg).toContain("<svg");
    expect(svg).toContain('width="200"');
    expect(svg).toContain('height="200"');
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });

  it("produces different SVG output for different payloads", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const shareA = { x: 1, y: new Uint8Array([1, 2, 3]) };
    const shareB = { x: 2, y: new Uint8Array([9, 9, 9]) };

    const payloadA = buildEmergencyKitPayload(await encryptShare(shareA, key));
    const payloadB = buildEmergencyKitPayload(await encryptShare(shareB, key));

    const svgA = generateRecoveryQRCodeSVG(payloadA);
    const svgB = generateRecoveryQRCodeSVG(payloadB);

    expect(svgA).not.toBe(svgB);
  });

  it("generates a downloadable PDF containing only the encrypted share text", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const share = { x: 3, y: new Uint8Array([4, 4, 4, 4]) };
    const encrypted = await encryptShare(share, key);
    const payload = buildEmergencyKitPayload(encrypted, "Home phone");

    const pdfBytes = await generateEmergencyKitPDF(payload);

    // %PDF is the standard file signature for a valid PDF.
    const header = Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8");
    expect(header).toBe("%PDF-");
    expect(pdfBytes.length).toBeGreaterThan(100);
  });

  it("label is optional in emergency kit payload", async () => {
    const key = await globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const share = { x: 1, y: new Uint8Array([5, 10, 15]) };
    const encrypted = await encryptShare(share, key);

    const payload = buildEmergencyKitPayload(encrypted);
    expect(payload.label).toBeUndefined();
    expect(new Date(payload.createdAt).getTime()).not.toBeNaN();
  });
});
