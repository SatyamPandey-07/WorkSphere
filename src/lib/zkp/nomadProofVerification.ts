import crypto from "crypto";
import path from "path";
import { readFile } from "node:fs/promises";
import * as snarkjs from "snarkjs";
import { BN254_SCALAR_FIELD, poseidonHash } from "./poseidon";
import {
  createNomadProductivityStatement,
  generateBadgeSvgMarkup,
  type NomadProductivityStatement,
  type PassportStamp,
} from "./nomadProof";

export interface NomadActivityCounters {
  currentStreak: number;
  totalDeepWorkMinutes: number;
}

export interface NomadVerificationPayload {
  proof: unknown;
  publicSignals: unknown;
}

type NomadFailureCode =
  | "INVALID_REQUEST"
  | "INSUFFICIENT_ACTIVITY"
  | "INVALID_PROOF"
  | "VERIFIER_UNAVAILABLE";

interface NomadFailure {
  isValid: false;
  code: NomadFailureCode;
  error: string;
  status: 400 | 403 | 503;
}

interface NomadChallengeInput {
  minThresholdStreak: string;
  minThresholdHours: string;
  epoch: string;
  expectedCommitment: string;
  identitySecret: string;
  actualStreakDays: string;
  actualWorkMinutes: string;
}

export type NomadChallengeResult =
  | {
      ok: true;
      challenge: {
        statement: NomadProductivityStatement;
        input: NomadChallengeInput;
      };
    }
  | {
      ok: false;
      code: NomadFailureCode;
      error: string;
      status: 400 | 403 | 503;
    };

export type NomadVerificationResult =
  | {
      isValid: true;
      stamp: PassportStamp;
    }
  | NomadFailure;

function getPassportSigningKey(): string | null {
  const key = process.env.ZKP_PASSPORT_KEY;

  if (!key || Buffer.byteLength(key, "utf8") < 32) {
    return null;
  }

  return key;
}

const VERIFICATION_KEY_PATH =
  process.env.NOMAD_ZKP_VERIFICATION_KEY_PATH ||
  path.join(
    process.cwd(),
    "public",
    "zkp",
    "nomad_productivity_proof_vkey.json",
  );

let verificationKeyPromise: Promise<unknown> | null = null;

function fail(
  code: NomadFailureCode,
  error: string,
  status: 400 | 403 | 503,
): NomadFailure {
  return { isValid: false, code, error, status };
}

function deriveIdentitySecret(userId: string, epoch: number): string {
  const key = process.env.NOMAD_ZKP_IDENTITY_KEY;

  if (!key || Buffer.byteLength(key, "utf8") < 32) {
    throw new Error("NOMAD_ZKP_IDENTITY_KEY is not configured");
  }

  const digest = crypto
    .createHmac("sha256", key)
    .update(`worksphere_nomad_v1:${userId}:${epoch}`)
    .digest("hex");

  return ((BigInt(`0x${digest}`) % (BN254_SCALAR_FIELD - 1n)) + 1n).toString();
}

function validateActivity(activity: NomadActivityCounters): boolean {
  return (
    Number.isSafeInteger(activity?.currentStreak) &&
    activity.currentStreak >= 0 &&
    activity.currentStreak <= 0xffff &&
    Number.isSafeInteger(activity?.totalDeepWorkMinutes) &&
    activity.totalDeepWorkMinutes >= 0 &&
    activity.totalDeepWorkMinutes <= 0xffffffff
  );
}

/**
 * Builds a challenge exclusively from server-owned activity counters.
 * The browser receives proving inputs but cannot alter the expected
 * commitment without making its Groth16 proof unverifiable.
 */
export function createNomadProofChallenge(
  userId: string,
  badgeType: unknown,
  activity: NomadActivityCounters,
): NomadChallengeResult {
  if (!userId || typeof userId !== "string") {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      error: "Authenticated user is required.",
      status: 400,
    };
  }

  const statement = createNomadProductivityStatement(badgeType);

  if (!statement || !validateActivity(activity)) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      error: "Invalid Nomad badge request or activity counters.",
      status: 400,
    };
  }

  if (
    activity.currentStreak < statement.minThresholdStreak ||
    activity.totalDeepWorkMinutes < statement.minThresholdHours * 60
  ) {
    return {
      ok: false,
      code: "INSUFFICIENT_ACTIVITY",
      error: "Recorded activity does not meet this badge's requirements.",
      status: 403,
    };
  }

  try {
    const identitySecret = deriveIdentitySecret(userId, statement.epoch);
    const secret = BigInt(identitySecret);
    const epoch = BigInt(statement.epoch);

    const identityCommitment = poseidonHash([secret, epoch]);

    // Must match the circuit's Poseidon(3) activityHasher exactly.
    const expectedCommitment = poseidonHash([
      identityCommitment,
      BigInt(activity.currentStreak),
      BigInt(activity.totalDeepWorkMinutes),
    ]).toString();

    return {
      ok: true,
      challenge: {
        statement,
        input: {
          minThresholdStreak: String(statement.minThresholdStreak),
          minThresholdHours: String(statement.minThresholdHours),
          epoch: String(statement.epoch),
          expectedCommitment,
          identitySecret,
          actualStreakDays: String(activity.currentStreak),
          actualWorkMinutes: String(activity.totalDeepWorkMinutes),
        },
      },
    };
  } catch {
    return {
      ok: false,
      code: "VERIFIER_UNAVAILABLE",
      error: "Nomad proof infrastructure is not configured.",
      status: 503,
    };
  }
}

function isFieldElement(value: unknown): value is string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    return false;
  }

  try {
    const parsed = BigInt(value);
    return parsed >= 0n && parsed < BN254_SCALAR_FIELD;
  } catch {
    return false;
  }
}

function isGroth16Proof(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;

  const proof = value as Record<string, unknown>;

  const point = (candidate: unknown, length: number) =>
    Array.isArray(candidate) &&
    candidate.length === length &&
    candidate.every(
      (coordinate) =>
        typeof coordinate === "string" && /^[0-9]+$/.test(coordinate),
    );

  return (
    proof.protocol === "groth16" &&
    proof.curve === "bn128" &&
    point(proof.pi_a, 3) &&
    point(proof.pi_c, 3) &&
    Array.isArray(proof.pi_b) &&
    proof.pi_b.length === 3 &&
    proof.pi_b.every((entry) => point(entry, 2))
  );
}

function expectedPublicSignals(
  challenge: NonNullable<
    Extract<NomadChallengeResult, { ok: true }>["challenge"]
  >,
): string[] {
  const { statement, input } = challenge;

  const nullifierHash = poseidonHash([
    BigInt(input.identitySecret),
    BigInt(statement.epoch) + 42n,
  ]).toString();

  // Verified order from the compiled Circom .sym file:
  // [nullifierHash, minThresholdStreak, minThresholdHours, epoch, expectedCommitment]
  return [
    nullifierHash,
    String(statement.minThresholdStreak),
    String(statement.minThresholdHours),
    String(statement.epoch),
    input.expectedCommitment,
  ];
}

function resetCurve(): void {
  const global = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };

  if (global.curve_bn128) {
    void global.curve_bn128.terminate().catch(() => undefined);
    delete global.curve_bn128;
  }
}

async function loadVerificationKey(): Promise<unknown> {
  if (!verificationKeyPromise) {
    verificationKeyPromise = readFile(VERIFICATION_KEY_PATH, "utf8")
      .then((raw) => JSON.parse(raw) as unknown)
      .catch((error) => {
        verificationKeyPromise = null;
        throw error;
      });
  }

  return verificationKeyPromise;
}

export function resetNomadVerificationKeyCache(): void {
  verificationKeyPromise = null;
}

export async function verifyAndMintNomadPassportStamp(
  userId: string,
  badgeType: unknown,
  payload: NomadVerificationPayload,
  activity: NomadActivityCounters,
): Promise<NomadVerificationResult> {
  const prepared = createNomadProofChallenge(userId, badgeType, activity);

  if (!prepared.ok) {
    return {
      isValid: false,
      code: prepared.code,
      error: prepared.error,
      status: prepared.status,
    };
  }

  if (
    !isGroth16Proof(payload?.proof) ||
    !Array.isArray(payload?.publicSignals) ||
    payload.publicSignals.length !== 5 ||
    !payload.publicSignals.every(isFieldElement)
  ) {
    return fail(
      "INVALID_PROOF",
      "Malformed Groth16 proof or public signals.",
      400,
    );
  }

  const passportSigningKey = getPassportSigningKey();

  if (!passportSigningKey) {
    return fail(
      "VERIFIER_UNAVAILABLE",
      "Passport signing key is not configured.",
      503,
    );
  }
  const expected = expectedPublicSignals(prepared.challenge);
  const signals = payload.publicSignals as string[];

  if (!signals.every((signal, index) => signal === expected[index])) {
    return fail(
      "INVALID_PROOF",
      "Nomad proof public signals do not match the server-issued challenge.",
      400,
    );
  }

  let verificationKey: unknown;

  try {
    verificationKey = await loadVerificationKey();
  } catch {
    return fail(
      "VERIFIER_UNAVAILABLE",
      "Nomad verification key is unavailable.",
      503,
    );
  }

  let valid = false;

  try {
    valid = await snarkjs.groth16.verify(
      verificationKey as Parameters<typeof snarkjs.groth16.verify>[0],
      signals,
      payload.proof as Parameters<typeof snarkjs.groth16.verify>[2],
    );
  } catch {
    valid = false;
  } finally {
    resetCurve();
  }

  if (!valid) {
    return fail(
      "INVALID_PROOF",
      "Nomad Groth16 proof verification failed.",
      400,
    );
  }

  const statement = prepared.challenge.statement;
  const nullifierHash = expected[0];

  const nullifierHex = BigInt(nullifierHash).toString(16).padStart(64, "0");

  const stampId =
    `STAMP-${statement.badgeType}-${statement.epoch}-` +
    nullifierHex.slice(0, 8).toUpperCase();

  const issuedAt = new Date().toISOString();

  const signaturePayload = `${stampId}:${statement.badgeType}:${nullifierHash}:${statement.epoch}`;

  const verificationSignature = crypto
    .createHmac("sha256", passportSigningKey)
    .update(signaturePayload)
    .digest("hex");

  const stamp: PassportStamp = {
    stampId,
    badgeType: statement.badgeType,
    tierTitle: statement.tierTitle,
    epoch: statement.epoch,
    issuedAt,
    nullifierHash,
    verificationSignature,
    svgMarkup: "",
  };

  stamp.svgMarkup = generateBadgeSvgMarkup(stamp);

  return {
    isValid: true,
    stamp,
  };
}
