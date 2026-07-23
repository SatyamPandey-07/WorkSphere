/**
 * Shamir's Secret Sharing (2-of-3) & Web Crypto Encryption
 * Used for WebAuthn Passkey Master Secret Recovery
 */

// GF(2^8) implementation with Rijndael polynomial 0x11B
const expTable = new Uint8Array(256);
const logTable = new Uint8Array(256);

let x = 1;
for (let i = 0; i < 255; i++) {
  expTable[i] = x;
  logTable[x] = i;
  x <<= 1;
  if (x & 0x100) {
    x ^= 0x11b;
  }
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

export interface Share {
  x: number;
  y: Uint8Array;
}

export interface EncryptedShare {
  x: number;
  iv: string; // base64
  ciphertext: string; // base64
}

/**
 * Splits a master secret into 3 shares (2-of-3 threshold)
 */
export function splitSecret(secret: Uint8Array): [Share, Share, Share] {
  const a1 = new Uint8Array(secret.length);
  crypto.getRandomValues(a1);

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

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encrypts a share for distribution to a trusted device using AES-GCM
 */
export async function encryptShare(
  share: Share,
  key: CryptoKey,
): Promise<EncryptedShare> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    share.y as any,
  );

  return {
    x: share.x,
    iv: bufferToBase64(iv.buffer),
    ciphertext: bufferToBase64(ciphertext),
  };
}

/**
 * Decrypts a share received from a trusted device
 */
export async function decryptShare(
  encrypted: EncryptedShare,
  key: CryptoKey,
): Promise<Share> {
  const iv = base64ToBuffer(encrypted.iv);
  const ciphertext = base64ToBuffer(encrypted.ciphertext);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    key,
    ciphertext,
  );

  return {
    x: encrypted.x,
    y: new Uint8Array(plaintext),
  };
}
