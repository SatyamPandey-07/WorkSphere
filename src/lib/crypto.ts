// Use a provided key or fallback to a deterministic one for development.
// A 256-bit key needs 32 bytes.
const ENCRYPTION_KEY_STRING =
  process.env.ENCRYPTION_KEY || "development_fallback_key_32bytes!";

if (ENCRYPTION_KEY_STRING.length < 32) {
  throw new Error("ENCRYPTION_KEY must be at least 32 characters long.");
}

export const ENCRYPTION_KEY = Buffer.from(
  ENCRYPTION_KEY_STRING.slice(0, 32),
  "utf-8",
);
