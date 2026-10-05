/**
 * Isomorphic cryptographic encoding and buffer conversion utilities.
 * Handles Base64, Base64URL, ArrayBuffer, Uint8Array, and WebAuthn clientDataJSON decoding.
 */

/**
 * Encodes a Uint8Array or ArrayBuffer into a standard Base64 string.
 */
export function uint8ArrayToBase64(bytes: Uint8Array | ArrayBuffer): string {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(uint8).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a standard Base64 string into a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes an ArrayBuffer into a standard Base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64(buffer);
}

/**
 * Decodes a standard Base64 string into an ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return base64ToUint8Array(base64).buffer;
}

/**
 * Encodes a Uint8Array or ArrayBuffer into a URL-safe Base64 (base64url) string without padding.
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array | ArrayBuffer): string {
  return uint8ArrayToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a URL-safe Base64 (base64url) string into a Uint8Array.
 */
export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  let b64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) {
    b64 += "=".repeat(4 - pad);
  }
  return base64ToUint8Array(b64);
}

/**
 * Encodes an ArrayBuffer into a URL-safe Base64 (base64url) string without padding.
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  return uint8ArrayToBase64Url(buffer);
}

/**
 * Decodes a URL-safe Base64 (base64url) string into an ArrayBuffer.
 */
export function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  return base64UrlToUint8Array(base64Url).buffer;
}

/**
 * Encodes a string, Uint8Array, or ArrayBuffer into a URL-safe Base64 (base64url) string.
 */
export function encodeBase64Url(data: string | Uint8Array | ArrayBuffer): string {
  if (typeof data === "string") {
    return uint8ArrayToBase64Url(stringToUint8Array(data));
  }
  return uint8ArrayToBase64Url(data);
}

/**
 * Decodes a URL-safe Base64 (base64url) string into a UTF-8 string.
 */
export function decodeBase64Url(base64Url: string): string {
  return uint8ArrayToString(base64UrlToUint8Array(base64Url));
}

/**
 * Encodes a UTF-8 string into a Uint8Array.
 */
export function stringToUint8Array(str: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(str, "utf-8"));
  }
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes a Uint8Array into a UTF-8 string.
 */
export function uint8ArrayToString(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("utf-8");
  }
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return str;
}

/**
 * Converts an ArrayBuffer or Uint8Array to a hex string.
 */
export function arrayBufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Converts a hex string to a Uint8Array.
 */
export function hexToUint8Array(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Decodes a base64url WebAuthn clientDataJSON payload and parses its JSON object.
 */
export function parseClientDataJSON(clientDataJSON: string): {
  type?: string;
  challenge?: string;
  origin?: string;
  [key: string]: unknown;
} | null {
  try {
    const json = decodeBase64Url(clientDataJSON);
    return JSON.parse(json);
  } catch {
    return null;
  }
}
