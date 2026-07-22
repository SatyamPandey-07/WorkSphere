import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";
import fs from "fs";
import path from "path";
// @ts-expect-error - snarkjs types are missing
import * as snarkjs from "snarkjs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { proof, publicSignals } = await req.json();

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

    // Update user in Prisma
    await prisma.user.update({
      where: { id: userId },
      data: { isVerifiedStudent: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[VERIFY_STUDENT]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
