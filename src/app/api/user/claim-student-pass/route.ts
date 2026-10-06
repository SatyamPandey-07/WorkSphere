import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { isUniversityMerkleRootActive } from "@/lib/zkp/studentMembership";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");

/**
 * POST /api/user/claim-student-pass (#3959)
 *
 * Verifies zero-knowledge proof of student credential, validates against active
 * university Merkle root, checks and records unique anonymized nullifier to prevent
 * double-claiming, and grants student discount status without saving any real identity
 * info (name, student ID, or university email).
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { proof, publicSignals, nullifierHash: explicitNullifierHash } = body;

    if (!proof || !publicSignals || !Array.isArray(publicSignals)) {
      return NextResponse.json(
        { error: "Missing proof or publicSignals in request body" },
        { status: 400 },
      );
    }

    // Expected publicSignals:
    // When using student_access_pass circuit: [root, epoch, nullifierHash]
    // Or when passed explicitly in body along with [root, epoch]
    const root = String(publicSignals[0]);
    const epoch = Number(publicSignals[1]) || 2026;
    const nullifierHash =
      publicSignals.length >= 3
        ? String(publicSignals[2])
        : explicitNullifierHash
          ? String(explicitNullifierHash)
          : null;

    if (!nullifierHash) {
      return NextResponse.json(
        { error: "Missing anonymized nullifier hash" },
        { status: 400 },
      );
    }

    // 1. Check double-spend / replay: verify nullifier hasn't been claimed for this academic epoch
    const existingClaim = await prisma.studentPassNullifier.findFirst({
      where: { nullifierHash, epoch },
    });

    if (existingClaim) {
      return NextResponse.json(
        {
          error: "Nullifier already used",
          message: "This student verifiable credential has already claimed an access pass for this epoch.",
          code: "NULLIFIER_ALREADY_CLAIMED",
        },
        { status: 409 },
      );
    }

    // 2. Validate that the root belongs to an accredited, active university
    const isRootActive = await isUniversityMerkleRootActive(root, epoch);
    if (!isRootActive) {
      return NextResponse.json(
        { error: "Invalid or inactive university Merkle root" },
        { status: 400 },
      );
    }

    // 3. Load verification key
    const accessPassVKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "student_access_pass_vkey.json",
    );
    const membershipVKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "student_membership_vkey.json",
    );
    const fallbackVKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "verification_key.json",
    );

    const vKeyPath = fs.existsSync(accessPassVKeyPath)
      ? accessPassVKeyPath
      : fs.existsSync(membershipVKeyPath)
        ? membershipVKeyPath
        : fallbackVKeyPath;

    if (!fs.existsSync(vKeyPath)) {
      return NextResponse.json(
        { error: "Verification key not found" },
        { status: 500 },
      );
    }

    const vKey = JSON.parse(fs.readFileSync(vKeyPath, "utf-8"));

    // 4. Verify zero-knowledge proof validity
    // Signals must match nPublic exactly: truncating would unbind the nullifier.
    if (publicSignals.length !== vKey.nPublic) {
      return NextResponse.json(
        { error: "publicSignals length mismatch" },
        { status: 400 },
      );
    }

    const isValid = await snarkjs.groth16.verify(
      vKey,
      publicSignals,
      proof,
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid zero-knowledge proof" },
        { status: 400 },
      );
    }

    // 5. Atomic transaction: Record nullifier and grant student tier flag
    await prisma.$transaction([
      prisma.studentPassNullifier.create({
        data: {
          nullifierHash,
          epoch,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          isVerifiedStudent: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      verified: true,
      tier: "STUDENT_DISCOUNT",
      epoch,
    });
  } catch (error) {
    console.error("[CLAIM_STUDENT_PASS]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
