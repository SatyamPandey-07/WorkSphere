import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyZkNullifierProofs } from "@/lib/crypto/zkNullifierVerifier";

export const runtime = "nodejs";

const publicSignalSchema = z.string().trim().min(1);

const proofSchema = z.object({
  nullifierHash: z.string().trim().min(1),
  proof: z.object({
    pi_a: z.array(z.string()).min(2),
    pi_b: z.array(z.array(z.string()).min(2)).min(2),
    pi_c: z.array(z.string()).min(2),
    protocol: z.string().optional(),
    curve: z.string().optional(),
  }),
  publicSignals: z.tuple([
    publicSignalSchema,
    publicSignalSchema,
    publicSignalSchema,
    publicSignalSchema,
  ]),
});

const bodySchema = z.object({
  venueId: z.string().trim().min(1),
  proofs: z.array(proofSchema).min(1).max(50),
});

type ProofResult = {
  index: number;
  venueId: string;
  nullifierHash: string;
  proofValid: boolean;
  nullifierStored: boolean;
  error?: string;
};

type NullifierBatchTransaction = {
  venueCheckInNullifier: {
    createMany: (args: {
      data: { nullifierHash: string; epoch: number; venueId: string }[];
      skipDuplicates: false;
    }) => Promise<unknown>;
  };
};

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { venueId, proofs } = parsed.data;
  const epochs: number[] = [];

  for (let index = 0; index < proofs.length; index++) {
    const item = proofs[index];
    const [merkleRoot, signalNullifierHash, signalVenueId, epochSignal] =
      item.publicSignals;
    const epoch = Number(epochSignal);

    if (
      merkleRoot === "" ||
      signalNullifierHash !== item.nullifierHash ||
      signalVenueId !== venueId ||
      !Number.isSafeInteger(epoch) ||
      epoch <= 0
    ) {
      return NextResponse.json(
        {
          error: "Invalid public signals.",
          index,
          details:
            "Each proof must bind its nullifier and venue, and include a positive integer epoch.",
        },
        { status: 400 },
      );
    }

    epochs.push(epoch);
  }

  let verifications: Awaited<ReturnType<typeof verifyZkNullifierProofs>>;
  try {
    verifications = await verifyZkNullifierProofs(
      proofs.map(({ proof, publicSignals }) => ({ proof, publicSignals })),
    );
  } catch {
    return NextResponse.json(
      { error: "ZK proof verifier is unavailable." },
      { status: 500 },
    );
  }

  const verifiedCount = verifications.filter((result) => result.valid).length;
  const results: ProofResult[] = proofs.map((item, index) => {
    const proofValid = verifications[index]?.valid === true;
    return {
      index,
      venueId,
      nullifierHash: item.nullifierHash,
      proofValid,
      nullifierStored: false,
      ...(!proofValid
        ? { error: "Invalid zero-knowledge proof." }
        : verifiedCount !== proofs.length
          ? { error: "Batch was not recorded because another proof failed." }
          : {}),
    };
  });

  if (verifiedCount !== proofs.length) {
    return NextResponse.json(
      {
        valid: false,
        venueId,
        verifiedCount,
        storedCount: 0,
        totalCount: proofs.length,
        results,
      },
      { status: 422 },
    );
  }

  try {
    await prisma.$transaction(
      (tx: NullifierBatchTransaction) =>
        tx.venueCheckInNullifier.createMany({
          data: proofs.map((item, index) => ({
            nullifierHash: item.nullifierHash,
            epoch: epochs[index],
            venueId,
          })),
          skipDuplicates: false,
        }),
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    const duplicate = isUniqueConstraintError(error);
    const message = duplicate
      ? "One or more nullifiers have already been spent."
      : "Failed to record batch nullifiers; no nullifiers were recorded.";

    return NextResponse.json(
      {
        valid: false,
        error: message,
        venueId,
        verifiedCount,
        storedCount: 0,
        totalCount: proofs.length,
        results: results.map((result) => ({ ...result, error: message })),
      },
      { status: duplicate ? 409 : 500 },
    );
  }

  return NextResponse.json({
    valid: true,
    venueId,
    verifiedCount,
    storedCount: proofs.length,
    totalCount: proofs.length,
    results: results.map((result) => ({
      ...result,
      nullifierStored: true,
    })),
  });
}
