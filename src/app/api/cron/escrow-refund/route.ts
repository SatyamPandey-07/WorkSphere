import { NextResponse } from "next/server";
 feature/solana-optimistic-escrow-simulation
import { PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/prisma";
 main
import {
  deriveEscrowPda,
  buildRefundTransaction,
  isEscrowExpired,
} from "@/lib/solana/escrowClient";

 feature/solana-optimistic-escrow-simulation
const prisma = new PrismaClient();

export const dynamic = "force-dynamic";
 main

export async function GET(req: Request) {
  try {
    // 1. Bearer Token Authorization Guard
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Query expired or cancelled bookings
    const eligibleBookings = await prisma.booking.findMany({
      where: {
 feature/solana-optimistic-escrow-simulation
        status: { in: ["EXPIRED", "CANCELLED"] },
        escrowStatus: "DEPOSITED",
        checkInProof: null,

        status: "CANCELLED",
 main
      },
    });

    const processedRefunds = [];

    for (const booking of eligibleBookings) {
      // 3. Verify 24-hour grace period expiry
 feature/solana-optimistic-escrow-simulation
      const bookingDate = (booking as any).bookingDate || (booking as any).createdAt;

      const bookingDate =
        (booking as any).bookingDate || (booking as any).createdAt;
 main
      if (!isEscrowExpired(new Date(bookingDate), 24)) {
        continue;
      }

      // 4. Derive Vault PDA
      const [vaultPda] = deriveEscrowPda(booking.id);
 feature/solana-optimistic-escrow-simulation
      const userPubKey = (booking as any).userPublicKey || (booking as any).userWallet || "";

      const userPubKey =
        (booking as any).userPublicKey || (booking as any).userWallet || "";
 main

      if (!userPubKey) {
        continue;
      }

 feature/solana-optimistic-escrow-simulation
      const mockBlockhash = "11111111111111111111111111111111";

      // 5. Construct Unsigned Transaction Base64
      const unsignedTx = await buildRefundTransaction({
        bookingId: booking.id,
        userPublicKey: userPubKey,
        vaultPda: vaultPda.toBase58(),
        recentBlockhash: mockBlockhash,
      });

      // 5. Construct Unsigned Transaction Base64
      let _unsignedTx = "";
      try {
        const refundResult = await buildRefundTransaction({
          bookingId: booking.id,
          reason: "Auto-refund for cancelled booking",
          closureTimestamp: Math.floor(Date.now() / 1000),
          depositorWallet: userPubKey,
          authorityWallet: userPubKey,
          rpcUrl:
            process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
            "https://api.devnet.solana.com",
        });
        _unsignedTx = refundResult.serializedTransaction;
      } catch (err) {
        console.warn(
          `[EscrowRefund] Failed to build refund for booking ${booking.id}:`,
          err,
        );
        continue;
      }
 main

      // 6. Transition state to REFUND_PENDING
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
 feature/solana-optimistic-escrow-simulation
          escrowStatus: "REFUND_PENDING",
          refundTransaction: unsignedTx,
        } as any,

          status: "CANCELLED",
        },
 main
      });

      processedRefunds.push({
        bookingId: booking.id,
        vaultPda: vaultPda.toBase58(),
        status: "REFUND_PENDING",
 feature/solana-optimistic-escrow-simulation

        transaction: _unsignedTx,
 main
      });
    }

    return NextResponse.json({
      success: true,
      processedCount: processedRefunds.length,
      refunds: processedRefunds,
    });
  } catch (error: any) {
    console.error("Escrow refund scanner error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
 feature/solana-optimistic-escrow-simulation
}

}
 main
