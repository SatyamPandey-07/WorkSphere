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
    const { proof, publicSignals, witness } = body;

    if (!proof || !publicSignals || !Array.isArray(publicSignals)) {
      return NextResponse.json(
        { error: "Missing proof or publicSignals" },
        { status: 400 },
      );
    }

    // ── Multi-Campus Merkle Membership Proof (#3480) ────────────────────────
    // When publicSignals contains [root, epoch], verify against active university Merkle root
    if (publicSignals.length >= 2) {
      const root = String(publicSignals[0]);
      const epoch = Number(publicSignals[1]) || 2026;

      // 1. Verify that the root matches an active university Merkle root stored in DB
      const isRootActive = await isUniversityMerkleRootActive(root, epoch);
      if (!isRootActive) {
        return NextResponse.json(
          { error: "Invalid or inactive university Merkle root" },
          { status: 400 },
        );
      }

      // 2. Load student membership verification key
      const studentVKeyPath = path.join(
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
      const vKeyPath = fs.existsSync(studentVKeyPath)
        ? studentVKeyPath
        : fallbackVKeyPath;

      if (!fs.existsSync(vKeyPath)) {
        return NextResponse.json(
          { error: "Verification key not found" },
          { status: 500 },
        );
      }

      const vKey = JSON.parse(fs.readFileSync(vKeyPath, "utf-8"));

      // 3. Verify Groth16 zero-knowledge proof
      const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
      if (!isValid) {
        return NextResponse.json(
          { error: "Invalid zero-knowledge proof" },
          { status: 400 },
        );
      }

      // 4. Update user in Prisma
      await prisma.user.update({
        where: { id: userId },
        data: { isVerifiedStudent: true },
      });

      return NextResponse.json({ success: true, verified: true });
    }

    // ── Single-Signal Proof Verification (Legacy / Token Commitment) ────────
    const vKeyPath = path.join(
      process.cwd(),
      "public",
      "zkp",
      "verification_key.json",
    );
    if (!fs.existsSync(vKeyPath)) {
      return NextResponse.json(
        { error: "Verification key not found" },
        { status: 500 },
      );
    }

    const vKey = JSON.parse(fs.readFileSync(vKeyPath, "utf-8"));

    // Verify the proof
    const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid zero-knowledge proof" },
        { status: 400 },
      );
    }

    // Check Revocation Merkle Tree
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

    // Update user in Prisma
    await prisma.user.update({
      where: { id: userId },
      data: { isVerifiedStudent: true },
    });

    return NextResponse.json({ success: true, verified: true });
  } catch (error) {
    console.error("[VERIFY_STUDENT]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
