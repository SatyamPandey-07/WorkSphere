/**
 * settle/route.ts
 * API endpoint that processes cryptographically verified ECDSA P-256 settlement
 * of a completed time-barter session with double-spend prevention.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import {
  IOUCryptographicSigner,
  type IOUPayload,
} from "@/core/ledger/IOUCryptographicSigner";

export const dynamic = "force-dynamic";

export interface SettlementRequest {
  agreementId: string;
  providerId?: string;
  receiverId?: string;
  amountMinutes?: number;
  providerSignature: string;
  receiverSignature: string;
  timestamp: number;
  nonce?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: SettlementRequest = await request.json();
    const {
      agreementId,
      providerSignature,
      receiverSignature,
      timestamp,
      nonce = "timebank-settle",
    } = body;

    if (
      !agreementId ||
      !providerSignature ||
      !receiverSignature ||
      !timestamp
    ) {
      return NextResponse.json(
        { error: "Missing required fields for settlement" },
        { status: 400 },
      );
    }

    // Look up persistent barter agreement from database
    const agreement = await prisma.barterAgreement.findUnique({
      where: { id: agreementId },
      include: { settlement: true },
    });

    if (!agreement) {
      return NextResponse.json(
        { error: "Barter agreement not found" },
        { status: 404 },
      );
    }

    // Verify caller is a legitimate participant in this barter agreement
    if (agreement.providerId !== userId && agreement.receiverId !== userId) {
      return NextResponse.json(
        {
          error:
            "Forbidden: Caller is not an authorized participant in this barter agreement",
        },
        { status: 403 },
      );
    }

    // Double-spend check: prevent re-settling an already settled agreement
    if (agreement.state === "SETTLED" || agreement.settlement) {
      return NextResponse.json(
        {
          error: "Agreement already settled (double-spend attempt)",
          code: "DOUBLE_SPEND_PREVENTED",
        },
        { status: 409 },
      );
    }

    // Must be in COMPLETED state to be settled
    if (agreement.state !== "COMPLETED") {
      return NextResponse.json(
        {
          error: `Cannot settle agreement in ${agreement.state} state. Must be COMPLETED.`,
        },
        { status: 400 },
      );
    }

    // Verify ECDSA P-256 signatures of both parties using authoritative agreement attributes
    const iouPayload: IOUPayload = {
      agreementId: agreement.id,
      providerId: agreement.providerId,
      receiverId: agreement.receiverId,
      amountMinutes: agreement.amountMinutes,
      timestamp,
      nonce,
    };

    const verifier = new IOUCryptographicSigner("verifier");

    const isProviderSigValid = await verifier.verifyIOU(
      iouPayload,
      providerSignature,
      agreement.providerPubKey,
    );

    const isReceiverSigValid = await verifier.verifyIOU(
      iouPayload,
      receiverSignature,
      agreement.receiverPubKey,
    );

    if (!isProviderSigValid || !isReceiverSigValid) {
      return NextResponse.json(
        { error: "Invalid cryptographic signatures" },
        { status: 401 },
      );
    }

    // Transactionally record settlement and transition agreement state to SETTLED
    const settledAt = new Date();
    const [_updatedAgreement, settlement] = await prisma.$transaction([
      prisma.barterAgreement.update({
        where: { id: agreementId },
        data: { state: "SETTLED" },
      }),
      prisma.timebankSettlement.create({
        data: {
          agreementId,
          providerId: agreement.providerId,
          receiverId: agreement.receiverId,
          amountMinutes: agreement.amountMinutes,
          providerSig: providerSignature,
          receiverSig: receiverSignature,
          nonce,
          settledAt,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "Settlement processed successfully",
      data: {
        settlementId: settlement.id,
        agreementId,
        providerId: agreement.providerId,
        receiverId: agreement.receiverId,
        amountMinutes: agreement.amountMinutes,
        settledAt: settlement.settledAt.getTime(),
      },
    });
  } catch (error: any) {
    console.error("[Settle API] Error processing settlement:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
