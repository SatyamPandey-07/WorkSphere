import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { claimVenueNullifier } from "@/lib/zkp/nullifierLedger";
import { issueAnonymousCheckInToken } from "@/lib/zkp/venueAccessToken";

// snarkjs requires the Node.js runtime (fs, crypto, worker_threads).
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");

const proofSchema = z.object({
  pi_a: z.array(z.string()).min(2),
  pi_b: z.array(z.array(z.string())).min(2),
  pi_c: z.array(z.string()).min(2),
  protocol: z.string().optional(),
  curve: z.string().optional(),
});

const publicSignal = z.string().min(1);

const bodySchema = z.object({
  proof: proofSchema,
  // Order mandated by the circuit: [merkleRoot, nullifierHash, venueId, currentEpoch]
  publicSignals: z.tuple([publicSignal, publicSignal, publicSignal, publicSignal]),
});

/**
 * POST /api/auth/zkp/verify-nullifier
 *
 * Verifies a Groth16 zk-SNARK proving anonymous venue membership and
 * atomically records the nullifier for the current epoch so the same proof
 * cannot be replayed for a second check-in.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body.", 400, "VALIDATION_FAILED");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      "Validation failed. Expected proof { pi_a, pi_b, pi_c } and publicSignals [merkleRoot, nullifierHash, venueId, currentEpoch].",
      400,
      "VALIDATION_FAILED",
    );
  }

  const [merkleRoot, nullifierHash, venueId, epochSignal] =
    parsed.data.publicSignals;
  const currentEpoch = Number(epochSignal);

  if (
    !Number.isSafeInteger(currentEpoch) ||
    currentEpoch <= 0 ||
    merkleRoot.trim() === "" ||
    nullifierHash.trim() === "" ||
    venueId.trim() === ""
  ) {
    return apiError(
      "Invalid public signals: currentEpoch must be a positive integer.",
      400,
      "VALIDATION_FAILED",
    );
  }

  const vKeyPath = path.join(
    process.cwd(),
    "public",
    "zkp",
    "verification_key.json",
  );

  let vKey: unknown;
  try {
    vKey = JSON.parse(fs.readFileSync(vKeyPath, "utf-8"));
  } catch (error) {
    console.error("[ZKP_VERIFY_NULLIFIER_VKEY]", error);
    return apiError("Verification key not found.", 500, "INTERNAL_ERROR");
  }

  let isValid = false;
  try {
    isValid = await snarkjs.groth16.verify(
      vKey,
      parsed.data.publicSignals,
      parsed.data.proof,
    );
  } catch (error) {
    console.error("[ZKP_VERIFY_NULLIFIER_GROTH16]", error);
    return apiError(
      "Malformed proof parameters or public signals.",
      400,
      "VALIDATION_FAILED",
    );
  }

  if (!isValid) {
    return apiError(
      "Invalid zero-knowledge proof.",
      400,
      "VALIDATION_FAILED",
    );
  }

  let claimResult: "claimed" | "duplicate";
  try {
    claimResult = await claimVenueNullifier({
      nullifierHash,
      epoch: currentEpoch,
      venueId,
    });
  } catch (error) {
    console.error("[ZKP_VERIFY_NULLIFIER_LEDGER]", error);
    return apiError(
      "Failed to record nullifier.",
      500,
      "INTERNAL_ERROR",
    );
  }

  if (claimResult === "duplicate") {
    return apiError(
      "This nullifier has already been used in the current epoch.",
      409,
      "NULLIFIER_ALREADY_SPENT",
    );
  }

  const accessToken = issueAnonymousCheckInToken(
    venueId,
    nullifierHash,
    currentEpoch,
  );

  return apiSuccess({
    verified: true,
    venueId,
    epoch: currentEpoch,
    nullifierHash,
    accessToken,
  });
}
