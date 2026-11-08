import { NextRequest, NextResponse } from "next/server";
import {
  type SolanaPayStatusResponse,
  SOLANA_PAY_DEFAULT_TIMEOUT_MS,
  isSolanaPaymentExpired,
} from "@/lib/payments/solanaPay";

export const dynamic = "force-dynamic";

// Process-local in-memory reference status store for dev/test simulation and pending polling tracking.
// Note: This state is process-local and does not survive restarts or scale across multi-instance nodes.
const referenceStore = new Map<string, SolanaPayStatusResponse>();

function isSimulationPermitted(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.ENABLE_SOLANA_PAYMENT_SIMULATION === "true"
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const reference = searchParams.get("reference");

    if (!reference) {
      return NextResponse.json(
        { error: "Missing required 'reference' query parameter" },
        { status: 400 }
      );
    }

    const simulateConfirm = searchParams.get("simulate") === "true";
    const simulateExpired = searchParams.get("expired") === "true";

    // Strict simulation rejection if not explicitly permitted
    if (simulateConfirm || simulateExpired) {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "Payment simulation is disabled in production" },
          { status: 400 }
        );
      }
      if (process.env.ENABLE_SOLANA_PAYMENT_SIMULATION !== "true") {
        return NextResponse.json(
          { error: "Payment simulation is disabled. Set ENABLE_SOLANA_PAYMENT_SIMULATION=true to enable." },
          { status: 400 }
        );
      }
    }

    const now = Date.now();

    // Dev / Test simulation: manual expiration trigger
    if (simulateExpired && isSimulationPermitted()) {
      const expiredData: SolanaPayStatusResponse = {
        reference,
        status: "EXPIRED",
        message: "Transaction expired. Please generate a new QR code.",
        timestamp: new Date().toISOString(),
        createdAt: now - SOLANA_PAY_DEFAULT_TIMEOUT_MS - 1000,
      };
      referenceStore.set(reference, expiredData);
      return NextResponse.json(expiredData);
    }

    // Dev / Test simulation: manual confirmation trigger
    if (simulateConfirm && isSimulationPermitted()) {
      const statusData: SolanaPayStatusResponse = {
        reference,
        status: "CONFIRMED",
        signature: `5K2x${Math.random().toString(36).substring(2, 15)}SolanaTxSig${now}`,
        slot: 248901234,
        timestamp: new Date().toISOString(),
        createdAt: referenceStore.get(reference)?.createdAt ?? now,
      };
      referenceStore.set(reference, statusData);
      return NextResponse.json(statusData);
    }

    // Default / Production path: Fail-closed initialization without synthetic metadata
    if (!referenceStore.has(reference)) {
      const statusData: SolanaPayStatusResponse = {
        reference,
        status: "PENDING",
        timestamp: new Date().toISOString(),
        createdAt: now,
      };
      referenceStore.set(reference, statusData);
    }

    const currentStatus = referenceStore.get(reference)!;

    // Process-local TTL check against server first-seen timestamp (blockhash TTL ~5 mins).
    // Note: State is process-local; if the process restarts or memory clears, expiry timing resets to a new first-seen time.
    if (
      currentStatus.status === "PENDING" &&
      currentStatus.createdAt &&
      isSolanaPaymentExpired(currentStatus.createdAt, SOLANA_PAY_DEFAULT_TIMEOUT_MS, now)
    ) {
      currentStatus.status = "EXPIRED";
      currentStatus.message = "Transaction expired. Please generate a new QR code.";
      currentStatus.timestamp = new Date().toISOString();
      referenceStore.set(reference, currentStatus);
    }

    // In production, ensure no execution path can return a synthetic or in-memory CONFIRMED status
    if (process.env.NODE_ENV === "production" && currentStatus.status === "CONFIRMED") {
      return NextResponse.json({
        reference,
        status: "PENDING",
        timestamp: new Date().toISOString(),
        createdAt: currentStatus.createdAt,
      });
    }

    return NextResponse.json(currentStatus);
  } catch (err: any) {
    const errorMessage = err?.message || "Failed to check Solana payment status";
    if (errorMessage.toLowerCase().includes("simulation failed") || errorMessage.toLowerCase().includes("timeout")) {
      return NextResponse.json({
        status: "EXPIRED",
        message: "Transaction expired. Please generate a new QR code.",
      });
    }
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { reference, action } = body;

    if (!reference || typeof reference !== "string") {
      return NextResponse.json(
        { error: "Missing 'reference' field" },
        { status: 400 }
      );
    }

    if (action !== "confirm" && action !== "expire") {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Manual payment actions are forbidden in production" },
        { status: 403 }
      );
    }

    if (process.env.ENABLE_SOLANA_PAYMENT_SIMULATION !== "true") {
      return NextResponse.json(
        { error: "Payment simulation is disabled. Set ENABLE_SOLANA_PAYMENT_SIMULATION=true to enable." },
        { status: 403 }
      );
    }

    if (action === "confirm") {
      const updated: SolanaPayStatusResponse = {
        reference,
        status: "CONFIRMED",
        signature: `5K2x${Math.random().toString(36).substring(2, 15)}SolanaTxSig${Date.now()}`,
        slot: 248901234,
        timestamp: new Date().toISOString(),
        createdAt: referenceStore.get(reference)?.createdAt ?? Date.now(),
      };
      referenceStore.set(reference, updated);
      return NextResponse.json(updated);
    }

    if (action === "expire") {
      const updated: SolanaPayStatusResponse = {
        reference,
        status: "EXPIRED",
        message: "Transaction expired. Please generate a new QR code.",
        timestamp: new Date().toISOString(),
        createdAt: referenceStore.get(reference)?.createdAt ?? Date.now() - SOLANA_PAY_DEFAULT_TIMEOUT_MS - 1000,
      };
      referenceStore.set(reference, updated);
      return NextResponse.json(updated);
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
