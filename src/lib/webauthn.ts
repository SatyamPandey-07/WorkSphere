/**
 * Compatibility bridge: Re-export WebAuthn helpers from consolidated module @/lib/auth/passkeys
 * and encoding helpers from @/lib/crypto/encoding.
 */

export * from "@/lib/auth/passkeys";
export { parseClientDataJSON } from "@/lib/crypto/encoding";
