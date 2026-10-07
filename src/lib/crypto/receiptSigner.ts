import crypto from "crypto";

export type SignatureAlgorithm = "RSA-SHA256" | "ECDSA-P256" | "ECDSA-P384";

export interface AlgorithmConfig {
  type: "rsa" | "ec";
  hash: "SHA256" | "SHA384";
  curve?: string;
  modulusLength?: number;
  dsaEncoding?: "der";
  padding?: number;
}

export const ALGORITHM_CONFIGS: Record<SignatureAlgorithm, AlgorithmConfig> = {
  "RSA-SHA256": {
    type: "rsa",
    hash: "SHA256",
    modulusLength: 2048,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  },
  "ECDSA-P256": {
    type: "ec",
    hash: "SHA256",
    curve: "prime256v1",
    dsaEncoding: "der",
  },
  "ECDSA-P384": {
    type: "ec",
    hash: "SHA384",
    curve: "secp384r1",
    dsaEncoding: "der",
  },
};

export interface ReservationReceiptPayload {
  bookingId: string;
  confirmationId: string;
  venueId: string;
  venueName: string;
  userId: string;
  userEmail?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationHours?: number;
  totalAmount: number;
  currency: string;
  issuedAt: string; // ISO timestamp
  status: string;
}

export interface CryptographicReceiptSignature {
  signature: string; // Base64 encoded signature
  algorithm: SignatureAlgorithm;
  publicKeyPem: string;
  digest: string; // SHA-256 hex digest of canonical payload
  canonicalPayload: string; // Canonical JSON string
  signedAt: string; // ISO timestamp
  keyId?: string;
}

export interface ReceiptVerificationResult {
  valid: boolean;
  algorithm: SignatureAlgorithm;
  digestMatches: boolean;
  signerIdentity?: string;
  error?: string;
  timestamp?: string;
}

/**
 * Deterministically creates a canonical JSON string for signing by sorting keys
 * and omitting undefined values.
 */
export function canonicalizeReceiptPayload(payload: ReservationReceiptPayload): string {
  const sortedKeys = Object.keys(payload).sort() as (keyof ReservationReceiptPayload)[];
  const sortedObj: Record<string, any> = {};
  for (const k of sortedKeys) {
    if (payload[k] !== undefined) {
      sortedObj[k] = payload[k];
    }
  }
  return JSON.stringify(sortedObj);
}

/**
 * Computes SHA-256 digest of the canonical receipt payload.
 */
export function computeReceiptDigest(canonicalJson: string): string {
  return crypto.createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

// In-memory or default signing keypairs for WorkSphere receipt authority
let defaultRsaKeyPair: { publicKey: string; privateKey: string } | null = null;
let defaultEcdsaP256KeyPair: { publicKey: string; privateKey: string } | null = null;
let defaultEcdsaP384KeyPair: { publicKey: string; privateKey: string } | null = null;

export function generateReceiptKeyPair(
  type: "RSA" | "ECDSA" | "ECDSA-P256" | "ECDSA-P384" | SignatureAlgorithm = "RSA"
): {
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const normType: SignatureAlgorithm =
    type === "RSA" || type === "RSA-SHA256"
      ? "RSA-SHA256"
      : type === "ECDSA-P384"
        ? "ECDSA-P384"
        : "ECDSA-P256";

  const config = ALGORITHM_CONFIGS[normType];
  if (config.type === "rsa") {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: config.modulusLength || 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: config.curve || "prime256v1",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKeyPem: publicKey, privateKeyPem: privateKey };
  }
}

function getDefaultKeyPair(algorithm: SignatureAlgorithm): {
  publicKeyPem: string;
  privateKeyPem: string;
} {
  if (algorithm === "RSA-SHA256") {
    if (!defaultRsaKeyPair) {
      const generated = generateReceiptKeyPair("RSA-SHA256");
      defaultRsaKeyPair = {
        publicKey: generated.publicKeyPem,
        privateKey: generated.privateKeyPem,
      };
    }
    return {
      publicKeyPem: defaultRsaKeyPair.publicKey,
      privateKeyPem: defaultRsaKeyPair.privateKey,
    };
  } else if (algorithm === "ECDSA-P384") {
    if (!defaultEcdsaP384KeyPair) {
      const generated = generateReceiptKeyPair("ECDSA-P384");
      defaultEcdsaP384KeyPair = {
        publicKey: generated.publicKeyPem,
        privateKey: generated.privateKeyPem,
      };
    }
    return {
      publicKeyPem: defaultEcdsaP384KeyPair.publicKey,
      privateKeyPem: defaultEcdsaP384KeyPair.privateKey,
    };
  } else {
    if (!defaultEcdsaP256KeyPair) {
      const generated = generateReceiptKeyPair("ECDSA-P256");
      defaultEcdsaP256KeyPair = {
        publicKey: generated.publicKeyPem,
        privateKey: generated.privateKeyPem,
      };
    }
    return {
      publicKeyPem: defaultEcdsaP256KeyPair.publicKey,
      privateKeyPem: defaultEcdsaP256KeyPair.privateKey,
    };
  }
}

/**
 * Cryptographically signs a reservation receipt payload using RSA or ECDSA.
 */
export function signReservationReceipt(
  payload: ReservationReceiptPayload,
  options: {
    algorithm?: SignatureAlgorithm;
    privateKeyPem?: string;
    publicKeyPem?: string;
    keyId?: string;
  } = {}
): CryptographicReceiptSignature {
  const algorithm = options.algorithm || "RSA-SHA256";
  const config = ALGORITHM_CONFIGS[algorithm] || ALGORITHM_CONFIGS["RSA-SHA256"];
  const keys =
    options.privateKeyPem && options.publicKeyPem
      ? { privateKeyPem: options.privateKeyPem, publicKeyPem: options.publicKeyPem }
      : getDefaultKeyPair(algorithm);

  const canonicalPayload = canonicalizeReceiptPayload(payload);
  const digest = computeReceiptDigest(canonicalPayload);

  const signer = crypto.createSign(config.hash);
  signer.update(canonicalPayload, "utf8");
  signer.end();

  const signOptions: crypto.SignPrivateKeyInput = {
    key: keys.privateKeyPem,
    ...(config.padding ? { padding: config.padding } : {}),
    ...(config.dsaEncoding ? { dsaEncoding: config.dsaEncoding } : {}),
  };

  const signatureBase64 = signer.sign(signOptions, "base64");

  return {
    signature: signatureBase64,
    algorithm,
    publicKeyPem: keys.publicKeyPem,
    digest,
    canonicalPayload,
    signedAt: new Date().toISOString(),
    keyId: options.keyId || "worksphere-authority-1",
  };
}

/**
 * Cryptographically verifies an RSA or ECDSA digital signature against receipt data.
 */
export function verifyReservationReceipt(
  payload: ReservationReceiptPayload,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SignatureAlgorithm = "RSA-SHA256",
  expectedDigest?: string
): ReceiptVerificationResult {
  try {
    const config = ALGORITHM_CONFIGS[algorithm] || ALGORITHM_CONFIGS["RSA-SHA256"];
    const canonicalPayload = canonicalizeReceiptPayload(payload);
    const computedDigest = computeReceiptDigest(canonicalPayload);
    const digestMatches = !expectedDigest || expectedDigest === computedDigest;

    const verifier = crypto.createVerify(config.hash);
    verifier.update(canonicalPayload, "utf8");
    verifier.end();

    const verifyOptions: crypto.VerifyPublicKeyInput = {
      key: publicKeyPem,
      ...(config.padding ? { padding: config.padding } : {}),
      ...(config.dsaEncoding ? { dsaEncoding: config.dsaEncoding } : {}),
    };

    const isSignatureValid = verifier.verify(
      verifyOptions,
      Buffer.from(signatureBase64, "base64")
    );
    const isValid = isSignatureValid && digestMatches;

    return {
      valid: isValid,
      algorithm,
      digestMatches,
      signerIdentity: isValid ? "WorkSphere Cryptographic Authority" : undefined,
      timestamp: new Date().toISOString(),
      ...(isValid ? {} : { error: "Signature verification failed" }),
    };
  } catch (err: unknown) {
    return {
      valid: false,
      algorithm,
      digestMatches: false,
      error: err instanceof Error ? err.message : "Invalid cryptographic signature format",
    };
  }
}

/**
 * Verifies raw buffer data (e.g. PDF receipt bytes) against RSA/ECDSA signature.
 */
export function verifyRawBufferSignature(
  dataBuffer: Uint8Array | Buffer,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SignatureAlgorithm = "RSA-SHA256"
): boolean {
  try {
    const config = ALGORITHM_CONFIGS[algorithm] || ALGORITHM_CONFIGS["RSA-SHA256"];
    const verifier = crypto.createVerify(config.hash);
    verifier.update(dataBuffer);
    verifier.end();

    const verifyOptions: crypto.VerifyPublicKeyInput = {
      key: publicKeyPem,
      ...(config.padding ? { padding: config.padding } : {}),
      ...(config.dsaEncoding ? { dsaEncoding: config.dsaEncoding } : {}),
    };

    return verifier.verify(
      verifyOptions,
      Buffer.from(signatureBase64, "base64")
    );
  } catch {
    return false;
  }
}
