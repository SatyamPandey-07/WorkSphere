 feat/redis-zkp-solana-desk-hold
import { NextRequest, NextResponse } from 'next/server';
import {
  verifyMembershipProof,
  type Groth16VerifyFn,
  type MembershipProofPayload,
} from '@/lib/zkp/membershipProofVerifier';
import { DeskLeaseManager } from '@/lib/reservations/leaseManager';
import {
  SolanaEscrowClient,
  type SolanaEscrowAdapter,
} from '@/lib/solana/escrowClient';

export interface DeskHoldDependencies {
  leaseManager: DeskLeaseManager;
  escrowClient: SolanaEscrowClient;
  groth16Verify?: Groth16VerifyFn;
  now?: () => number;
}

export function createDeskHoldHandler(deps: DeskHoldDependencies) {
  return async function POST(req: NextRequest) {
    let body: Partial<MembershipProofPayload> | null = null;
    try {
      body = (await req.json()) as Partial<MembershipProofPayload>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    if (!body?.deskId || !body?.slotWindow || !body?.proof || !body?.publicSignals) {
      return NextResponse.json(
        { error: 'deskId, slotWindow, proof, and publicSignals are required' },
        { status: 400 }
      );
    }

    const verification = await verifyMembershipProof(
      {
        deskId: body.deskId,
        slotWindow: body.slotWindow,
        proof: body.proof,
        publicSignals: body.publicSignals,
        verificationKey: body.verificationKey,
      },
      deps.groth16Verify
    );

    if (!verification.valid || !verification.merkleRoot) {
      return NextResponse.json(
        { error: verification.reason ?? 'INVALID_MEMBERSHIP_PROOF' },
        { status: 403 }
      );
    }

    const now = deps.now ? deps.now() : Date.now();
    const lease = await deps.leaseManager.acquireLease({
      deskId: body.deskId,
      slotWindow: body.slotWindow,
      proofHash: verification.proofHash,
      merkleRoot: verification.merkleRoot,
      now,
    });

    if (!lease) {
      return NextResponse.json(
        { error: 'DESK_ALREADY_HELD_OR_LOCKED' },
        { status: 409 }
      );
    }

    const escrowResult = await deps.escrowClient.confirmReservationEscrow({
      deskId: body.deskId,
      slotWindow: body.slotWindow,
      proofHash: verification.proofHash,
      merkleRoot: verification.merkleRoot,
    });

    if (!escrowResult.confirmed || !escrowResult.txSignature) {
      await deps.leaseManager.releaseLease(
        body.deskId,
        body.slotWindow,
        lease.ownerToken
      );
      return NextResponse.json(
        {
          error: escrowResult.error ?? 'ESCROW_CONFIRMATION_FAILED',
          released: true,
        },
        { status: 502 }
      );
    }

    const confirmedLease = await deps.leaseManager.promoteToConfirmed({
      deskId: body.deskId,
      slotWindow: body.slotWindow,
      ownerToken: lease.ownerToken,
      txSignature: escrowResult.txSignature,
      now: deps.now ? deps.now() : Date.now(),
    });

    if (!confirmedLease) {
      await deps.leaseManager.releaseLease(
        body.deskId,
        body.slotWindow,
        lease.ownerToken
      );
      return NextResponse.json(
        { error: 'LEASE_EXPIRED_BEFORE_CONFIRMATION', released: true },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        status: confirmedLease.status,
        deskId: confirmedLease.deskId,
        slotWindow: confirmedLease.slotWindow,
        proofHash: verification.proofHash,
        escrowPda: escrowResult.escrowPda,
        txSignature: escrowResult.txSignature,
        expiresAt: confirmedLease.expiresAt,
      },
      { status: 200 }
    );
  };
}

export function createDefaultDeskHoldHandler(
  redisClient: Parameters<typeof DeskLeaseManager>[0],
  escrowAdapter?: SolanaEscrowAdapter
) {
  return createDeskHoldHandler({
    leaseManager: new DeskLeaseManager(redisClient),
    escrowClient: new SolanaEscrowClient(escrowAdapter),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { acquireDeskHold } from "@/lib/reservations/leaseManager";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { venueId, seatIds, userId } = body;

    if (
      !venueId ||
      !Array.isArray(seatIds) ||
      seatIds.length === 0 ||
      !userId
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request body: venueId, seatIds array, and userId are required",
        },
        { status: 400 },
      );
    }

    const result = await acquireDeskHold({ venueId, seatIds, userId });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json(
      { success: true, holdIds: result.holdIds },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: "Internal server error", details: error.message },
      { status: 500 },
    );
  }
}
main
