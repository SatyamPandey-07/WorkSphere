import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import {
  getCurrentMerkleRoot,
  verifyMerkleProof,
  generateWitness,
} from "@/lib/zkp/revocation";
import { isUniversityMerkleRootActive } from "@/lib/zkp/studentMembership";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ verified: false });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isVerifiedStudent: true },
    });

    return NextResponse.json({ verified: user?.isVerifiedStudent ?? false });
  } catch (error) {
    console.error("[VERIFY_STUDENT_GET]", error);
    return NextResponse.json({ verified: false });
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();

    // Check for batch verification request
    if (Array.isArray(body) || (body && (Array.isArray(body.items) || Array.isArray(body.studentProofs)))) {
      const { verifyBatchStudentDiscountProofs } = await import("@/lib/zkp/batch");
      const batchPayload = Array.isArray(body) ? { items: body } : body;
      const verification = await verifyBatchStudentDiscountProofs(batchPayload);
      return NextResponse.json(verification, {
        status: verification.valid ? 200 : 207,
      });
    }

    const {
      proof,
      publicSignals,
      nullifierHash: explicitNullifierHash,
      root: explicitRoot,
      epoch: explicitEpoch,
      witness,
    } = body;

    // Validate that proof and publicSignals are provided
    if (!proof || !publicSignals || !Array.isArray(publicSignals) || publicSignals.length === 0) {
      return NextResponse.json(
        { error: "Missing proof or publicSignals in request body" },
        { status: 400 },
      );
    }

    // ── Extract Signals: Root, Epoch, Nullifier Hash ───────────────────────
    let root = explicitRoot ? String(explicitRoot) : String(publicSignals[0]);
    let epoch = explicitEpoch ? Number(explicitEpoch) : 2026;
    let nullifierHash: string | null = explicitNullifierHash
      ? String(explicitNullifierHash)
      : null;

    if (!nullifierHash && publicSignals.length >= 3) {
      const sig1 = String(publicSignals[1]);
      const sig2 = String(publicSignals[2]);
      if (sig1.length <= 6 && !isNaN(Number(sig1))) {
        epoch = Number(sig1);
        nullifierHash = sig2;
      } else if (sig2.length <= 6 && !isNaN(Number(sig2))) {
        epoch = Number(sig2);
        nullifierHash = sig1;
      } else {
        nullifierHash = sig2;
      }
    } else if (!nullifierHash && publicSignals.length === 2) {
      if (!isNaN(Number(publicSignals[1])) && Number(publicSignals[1]) < 100000) {
        epoch = Number(publicSignals[1]);
      } else {
        nullifierHash = String(publicSignals[1]);
      }
    } else if (!nullifierHash && publicSignals.length === 1 && !explicitRoot) {
      nullifierHash = String(publicSignals[0]);
    }

    if (explicitEpoch) {
      epoch = Number(explicitEpoch);
    }

    // ── 1. University Domain Hash / Merkle Root Validation ─────────────────
    // If multi-signal or explicit root is present, check against accredited university Merkle roots
    if (publicSignals.length >= 2 || explicitRoot) {
      const isRootActive = await isUniversityMerkleRootActive(root, epoch);
      if (!isRootActive) {
        return NextResponse.json(
          { error: "Invalid or inactive university Merkle root" },
          { status: 400 },
        );
      }
    }

    // ── 2. Nullifier Replay Attack Prevention ──────────────────────────────
    // Check if nullifier hash has been previously spent in the database
    if (nullifierHash) {
      const existingClaim = await prisma.studentClaimNullifier.findUnique({
        where: { nullifierHash },
      });

      if (existingClaim) {
        return NextResponse.json(
          {
            error: "Nullifier already used",
            message: "This nullifier hash has already been spent for anonymous student perk claims.",
            code: "NULLIFIER_ALREADY_SPENT",
          },
          { status: 409 },
        );
      }
    }

    // ── 3. Load Groth16 Verification Key (verification_key.json) ───────────
    const vKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "verification_key.json",
    );
    const studentPassVKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "student_access_pass_vkey.json",
    );
    const studentMembershipVKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "student_membership_vkey.json",
    );

    let keyToLoad = vKeyPath;
    if (publicSignals.length === 3 && fs.existsSync(studentPassVKeyPath)) {
      keyToLoad = studentPassVKeyPath;
    } else if (publicSignals.length === 2 && fs.existsSync(studentMembershipVKeyPath)) {
      keyToLoad = studentMembershipVKeyPath;
    } else if (fs.existsSync(vKeyPath)) {
      keyToLoad = vKeyPath;
    } else if (fs.existsSync(studentMembershipVKeyPath)) {
      keyToLoad = studentMembershipVKeyPath;
    }

    if (!fs.existsSync(keyToLoad)) {
      return NextResponse.json(
        { error: "Verification key not found" },
        { status: 500 },
      );
    }

    const vKey = JSON.parse(fs.readFileSync(keyToLoad, "utf-8"));

    // ── 4. Verify Proof using snarkjs Groth16 ──────────────────────────────
    let isValid = false;
    try {
      isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
    } catch (verifyError) {
      console.error("[VERIFY_STUDENT_GROTH16_ERROR]", verifyError);
      return NextResponse.json(
        { error: "Malformed or invalid proof signals" },
        { status: 400 },
      );
    }

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid zero-knowledge proof" },
        { status: 400 },
      );
    }

    // ── Single-Signal Revocation Check (Legacy fallback) ────────────────────
    if (publicSignals.length === 1 && witness) {
      const credentialHash = publicSignals[0];
      const currentWitness = witness || generateWitness(credentialHash);
      const currentRoot = await getCurrentMerkleRoot();
      const revoked = verifyMerkleProof(
        credentialHash,
        currentWitness,
        currentRoot,
      );

      if (revoked) {
        return NextResponse.json(
          { error: "Credential revoked" },
          { status: 403 },
        );
      }
    }

    // ── 5. Database Nullifier Tracking & User Status Update ────────────────
    if (nullifierHash) {
      try {
        await prisma.$transaction([
          prisma.studentClaimNullifier.create({
            data: {
              nullifierHash,
              epoch: Number(epoch) || 2026,
            },
          }),
          prisma.user.update({
            where: { id: userId },
            data: { isVerifiedStudent: true },
          }),
        ]);
      } catch (err: any) {
        if (err?.code === "P2002" || err?.message?.includes("Unique constraint")) {
          return NextResponse.json(
            {
              error: "Nullifier already used",
              message: "This nullifier hash has already been spent for anonymous student perk claims.",
              code: "NULLIFIER_ALREADY_SPENT",
            },
            { status: 409 },
          );
        }
        throw err;
      }
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: { isVerifiedStudent: true },
      });
    }

    return NextResponse.json({
      success: true,
      verified: true,
      nullifierHash: nullifierHash ?? undefined,
      epoch,
    });
  } catch (error) {
    console.error("[VERIFY_STUDENT]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
