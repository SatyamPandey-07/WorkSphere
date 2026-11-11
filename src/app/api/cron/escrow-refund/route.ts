import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  deriveEscrowPda,
  buildRefundTransaction,
  isEscrowExpired,
} from "@/lib/solana/escrowClient";

export const dynamic = "force-dynamic";

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
        status: "CANCELLED",
      },
    });

    const processedRefunds = [];

    for (const booking of eligibleBookings) {
      // 3. Verify 24-hour grace period expiry
      const bookingDate =
        (booking as any).bookingDate || (booking as any).createdAt;
      if (!isEscrowExpired(new Date(bookingDate), 24)) {
        continue;
      }

      // 4. Derive Vault PDA
      const [vaultPda] = deriveEscrowPda(booking.id);
      const userPubKey =
        (booking as any).userPublicKey || (booking as any).userWallet || "";

      if (!userPubKey) {
        continue;
      }

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

      // 6. Transition state to REFUND_PENDING
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: "CANCELLED",
        },
      });

      processedRefunds.push({
        bookingId: booking.id,
        vaultPda: vaultPda.toBase58(),
        status: "REFUND_PENDING",
        transaction: _unsignedTx,
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
}
