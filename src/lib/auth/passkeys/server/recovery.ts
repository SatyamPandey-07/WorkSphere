/**
 * Shamir's Secret Sharing (2-of-3) & Web Crypto Encryption
 * Used for WebAuthn Passkey Master Secret Recovery
 */

import { sanitizeSvg } from "@/lib/security/svgSanitizer";
import { generateQRCodeSVG } from "@/lib/qr/svgQr";
import { uint8ArrayToBase64, base64ToUint8Array } from "@/lib/crypto/encoding";
import type { Share, EncryptedShare, EmergencyKitPayload } from "../types";

const getCrypto = () => {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    return globalThis.crypto;
  }
  if (typeof require !== "undefined") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require("crypto");
      if (nodeCrypto && nodeCrypto.webcrypto) {
        return nodeCrypto.webcrypto;
      }
    } catch {}
  }
  return globalThis.crypto;
};

const webCrypto = getCrypto();

// GF(2^8) implementation with Rijndael polynomial 0x11B
const expTable = new Uint8Array(256);
const logTable = new Uint8Array(256);

let x = 1;
for (let i = 0; i < 255; i++) {
  expTable[i] = x;
  logTable[x] = i;
  let nextX = x << 1;
  if (nextX & 0x100) {
    nextX ^= 0x11b;
  }
  x = nextX ^ x;
}
expTable[255] = expTable[0];

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return expTable[(logTable[a] + logTable[b]) % 255];
}

function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("Divide by zero in GF(2^8)");
  if (a === 0) return 0;
  return expTable[(logTable[a] - logTable[b] + 255) % 255];
}

/**
 * Splits a master secret into 3 shares (2-of-3 threshold)
 */
export function splitSecret(secret: Uint8Array): [Share, Share, Share] {
  const a1 = new Uint8Array(secret.length);
  webCrypto.getRandomValues(a1);

  const shares: [Share, Share, Share] = [
    { x: 1, y: new Uint8Array(secret.length) },
    { x: 2, y: new Uint8Array(secret.length) },
    { x: 3, y: new Uint8Array(secret.length) },
  ];

  for (let i = 0; i < secret.length; i++) {
    const s = secret[i];
    const a = a1[i];

    // y = s + a * x (in GF)
    shares[0].y[i] = s ^ gfMul(a, 1);
    shares[1].y[i] = s ^ gfMul(a, 2);
    shares[2].y[i] = s ^ gfMul(a, 3);
  }

  return shares;
}

/**
 * Recovers the master secret from any 2 valid shares
 */
export function recoverSecret(share1: Share, share2: Share): Uint8Array {
  if (share1.x === share2.x) {
    throw new Error("Shares must have different X coordinates");
  }
  if (share1.y.length !== share2.y.length) {
    throw new Error("Share lengths must match");
  }

  const length = share1.y.length;
  const secret = new Uint8Array(length);
  const denom = share1.x ^ share2.x;

  for (let i = 0; i < length; i++) {
    const y1 = share1.y[i];
    const y2 = share2.y[i];

    const term1 = gfMul(y1, gfDiv(share2.x, denom));
    const term2 = gfMul(y2, gfDiv(share1.x, denom));

    secret[i] = term1 ^ term2;
  }

  return secret;
}

/**
 * Encrypts a share for distribution to a trusted device using AES-GCM
 */
export async function encryptShare(
  share: Share,
  key: CryptoKey,
): Promise<EncryptedShare> {
  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webCrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    share.y as any,
  );

  return {
    x: share.x,
    iv: uint8ArrayToBase64(iv),
    ciphertext: uint8ArrayToBase64(ciphertext),
  };
}

/**
 * Decrypts a share received from a trusted device
 */
export async function decryptShare(
  encrypted: EncryptedShare,
  key: CryptoKey,
): Promise<Share> {
  const iv = base64ToUint8Array(encrypted.iv);
  const ciphertext = base64ToUint8Array(encrypted.ciphertext);

  const plaintext = await webCrypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext),
  );

  return {
    x: encrypted.x,
    y: new Uint8Array(plaintext),
  };
}

/**
 * Builds the JSON payload that gets embedded in the recovery QR code / emergency kit.
 */
export function buildEmergencyKitPayload(
  share: EncryptedShare,
  label?: string,
): EmergencyKitPayload {
  if (!share || typeof share !== "object") {
    throw new Error("EncryptedShare is required to build emergency kit payload");
  }
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    share,
    label,
  };
}

/**
 * Renders a QR code as an SVG string encoding the emergency kit payload.
 */
export function generateRecoveryQRCodeSVG(
  payload: EmergencyKitPayload,
  size = 240,
): string {
  const safeSize = Math.max(1, Number(size) || 240);
  const data = JSON.stringify(payload);
  return generateQRCodeSVG(data, {
    size: safeSize,
    title: "Emergency Recovery Kit",
  });
}

/**
 * Generates a "Download Emergency Kit" PDF containing the recovery QR
 * code plus the raw encrypted payload as text.
 */
export async function generateEmergencyKitPDF(
  payload: EmergencyKitPayload,
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([420, 594]); // roughly A5 portrait
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 550;

  page.drawText("Passkey Recovery Emergency Kit", {
    x: 40,
    y,
    size: 16,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 28;

  if (payload.label) {
    page.drawText(`Label: ${payload.label}`, {
      x: 40,
      y,
      size: 10,
      font,
    });
    y -= 16;
  }

  page.drawText(`Created: ${payload.createdAt}`, {
    x: 40,
    y,
    size: 10,
    font,
  });
  y -= 16;

  page.drawText(`Share index: ${payload.share.x}`, {
    x: 40,
    y,
    size: 10,
    font,
  });
  y -= 24;

  page.drawText(
    "Scan the QR code with a compatible authenticator app, or store",
    { x: 40, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) },
  );
  y -= 12;
  page.drawText("the encrypted text below in a secure password manager.", {
    x: 40,
    y,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });
  y -= 24;

  page.drawText("Encrypted share (base64):", {
    x: 40,
    y,
    size: 10,
    font: boldFont,
  });
  y -= 16;

  const wrapWidth = 60;
  const ciphertext = payload.share.ciphertext;
  for (let i = 0; i < ciphertext.length; i += wrapWidth) {
    page.drawText(ciphertext.slice(i, i + wrapWidth), {
      x: 40,
      y,
      size: 8,
      font,
      color: rgb(0.15, 0.15, 0.15),
    });
    y -= 11;
    if (y < 40) break;
  }

  y -= 8;
  page.drawText(`IV (base64): ${payload.share.iv}`, {
    x: 40,
    y,
    size: 8,
    font,
    color: rgb(0.15, 0.15, 0.15),
  });

  return pdfDoc.save();
}

/**
 * Explicitly revokes and deletes a pending registration challenge token upon
 * verification failure or user cancellation to prevent challenge replay attacks.
 *
 * @param challengeId Optional challenge record ID to revoke
 * @param userId Optional userId whose active challenges should be invalidated
 * @param challengeToken Optional raw challenge string to delete
 */
export async function invalidateRegistrationChallenge(params: {
  challengeId?: string | null;
  userId?: string | null;
  challenge?: string | null;
}): Promise<number> {
  const { prisma } = await import("@/lib/prisma");
  const { challengeId, userId, challenge } = params;

  if (challengeId) {
    const deleted = await prisma.passkeyChallenge
      .deleteMany({
        where: { id: challengeId },
      })
      .catch(() => ({ count: 0 }));
    return deleted.count;
  }

  if (challenge) {
    const deleted = await prisma.passkeyChallenge
      .deleteMany({
        where: { challenge },
      })
      .catch(() => ({ count: 0 }));
    return deleted.count;
  }

  if (userId) {
    const deleted = await prisma.passkeyChallenge
      .deleteMany({
        where: { userId },
      })
      .catch(() => ({ count: 0 }));
    return deleted.count;
  }

  return 0;
}

/**
 * Revoke challenge token immediately upon verification error or cancellation.
 */
export const revokeChallenge = invalidateRegistrationChallenge;
export const cancelRegistrationChallenge = invalidateRegistrationChallenge;
