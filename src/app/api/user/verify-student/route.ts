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

    const { proof, publicSignals, witness } = await req.json();

    if (!proof || !publicSignals) {
      return NextResponse.json(
        { error: "Missing proof or publicSignals" },
        { status: 400 },
      );
    }

    // Load the verification key
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
    // The expectedCommit is typically the first public signal.
    const credentialHash = publicSignals[0];

    // Use provided witness or generate it server-side for legacy clients
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
