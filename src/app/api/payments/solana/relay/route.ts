import { NextRequest, NextResponse } from "next/server";
import {
  relayGaslessUsdcTransaction,
} from "@/lib/payments/solanaRelayer";
import type { GaslessTransactionRequest } from "@/lib/payments/solanaPay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: GaslessTransactionRequest;
  try {
    body = (await req.json()) as GaslessTransactionRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body.transaction !== "string" ||
    body.transaction.length === 0
  ) {
    return NextResponse.json(
      { error: "Missing base64-encoded transaction" },
      { status: 400 },
    );
  }

  try {
    const result = await relayGaslessUsdcTransaction(body.transaction);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to relay transaction";
    const status =
      message.includes("not configured") || message.includes("Unable to")
        ? 503
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
