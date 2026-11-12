import { NextRequest, NextResponse } from "next/server";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { simulateEscrowTransaction } from "@/lib/solana/escrowClient";

function deserializeSolanaTransaction(
  serializedBase64: string,
): Transaction | VersionedTransaction {
  const bytes = Buffer.from(serializedBase64, "base64");
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    return Transaction.from(bytes);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      serializedTransaction?: string;
      timeoutMs?: number;
    };

    if (
      !body.serializedTransaction ||
      typeof body.serializedTransaction !== "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_REQUEST",
          message: "serializedTransaction (base64) is required",
          retryable: false,
        },
        { status: 400 },
      );
    }

    const tx = deserializeSolanaTransaction(body.serializedTransaction);
    const result = await simulateEscrowTransaction(tx, {
      timeoutMs: body.timeoutMs,
    });

    if (!result.success) {
      const status = result.retryable ? 504 : 422;
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          message: result.message,
          retryable: result.retryable,
          attempts: result.attempts,
        },
        { status },
      );
    }

    return NextResponse.json(
      {
        success: true,
        logs: result.simulation.logs ?? [],
        unitsConsumed: result.simulation.unitsConsumed ?? 0,
        rpcEndpoint: result.rpcEndpoint,
        attempts: result.attempts,
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unexpected Solana payment error";
    return NextResponse.json(
      {
        success: false,
        error: "RPC_SIMULATION_TIMEOUT",
        message,
        retryable: true,
      },
      { status: 503 },
    );
  }
}
