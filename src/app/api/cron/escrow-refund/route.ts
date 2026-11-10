import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import {
  deriveEscrowPda,
  buildRefundTransaction,
  isEscrowExpired,
} from "@/lib/solana/escrowClient";

const prisma = new PrismaClient();

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
        status: { in: ["EXPIRED", "CANCELLED"] },
        escrowStatus: "DEPOSITED",
        checkInProof: null,
      },
    });

    const processedRefunds = [];

    for (const booking of eligibleBookings) {
      // 3. Verify 24-hour grace period expiry
      const bookingDate = (booking as any).bookingDate || (booking as any).createdAt;
      if (!isEscrowExpired(new Date(bookingDate), 24)) {
        continue;
      }

      // 4. Derive Vault PDA
      const [vaultPda] = deriveEscrowPda(booking.id);
      const userPubKey = (booking as any).userPublicKey || (booking as any).userWallet || "";

      if (!userPubKey) {
        continue;
      }

      const mockBlockhash = "11111111111111111111111111111111";

      // 5. Construct Unsigned Transaction Base64
      const unsignedTx = await buildRefundTransaction({
        bookingId: booking.id,
        userPublicKey: userPubKey,
        vaultPda: vaultPda.toBase58(),
        recentBlockhash: mockBlockhash,
      });

      // 6. Transition state to REFUND_PENDING
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          escrowStatus: "REFUND_PENDING",
          refundTransaction: unsignedTx,
        } as any,
      });

      processedRefunds.push({
        bookingId: booking.id,
        vaultPda: vaultPda.toBase58(),
        status: "REFUND_PENDING",
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