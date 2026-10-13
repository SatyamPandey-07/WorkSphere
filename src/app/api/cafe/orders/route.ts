/**
 * route.ts
 * /api/cafe/orders
 * Handles order creation, dynamic queue wait-time estimation, and active order tracking.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  SmartCafeEngine,
  SAMPLE_CAFE_MENU,
  OrderItemInput,
  CafeOrder,
} from "@/lib/cafe/smartCafeEngine";

// In-memory active orders store for real-time tracking
const activeOrdersStore = new Map<string, CafeOrder>();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const itemsInput: OrderItemInput[] = body.items || [];
    const customerName = body.customerName || "Nomad Professional";
    const deskNumber = body.deskNumber || "Desk #14B";
    const venueId = body.venueId || "venue-sf-01";
    const venueName = body.venueName || "SoMa Focus Hub & Artisan Roastery";

    if (!itemsInput || itemsInput.length === 0) {
      return NextResponse.json(
        { error: "Order must contain at least one item." },
        { status: 400 }
      );
    }

    const currentQueueLength = activeOrdersStore.size + 2; // simulated current queue load
    const calculation = SmartCafeEngine.calculateOrderDetails(
      itemsInput,
      SAMPLE_CAFE_MENU,
      currentQueueLength
    );

    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const { pickupCode, pickupToken } = SmartCafeEngine.generatePickupTokens(orderId);

    const now = Date.now();
    const estimatedReadyTime = now + calculation.estimatedPrepMinutes * 60 * 1000;

    const newOrder: CafeOrder = {
      id: orderId,
      venueId,
      venueName,
      customerName,
      deskNumber,
      items: calculation.calculatedItems,
      subtotal: calculation.subtotal,
      tax: calculation.tax,
      total: calculation.total,
      status: "received",
      createdAt: now,
      estimatedReadyTime,
      pickupToken,
      pickupCode,
      activeQueuePosition: currentQueueLength,
    };

    activeOrdersStore.set(orderId, newOrder);

    return NextResponse.json({
      success: true,
      order: newOrder,
      estimatedMinutes: calculation.estimatedPrepMinutes,
    });
  } catch (error: any) {
    console.error("[POST /api/cafe/orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to place mobile barista order", details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing required query parameter: orderId" },
        { status: 400 }
      );
    }

    const order = activeOrdersStore.get(orderId);
    if (!order) {
      // Fallback demo order if refreshed
      return NextResponse.json({
        success: false,
        error: "Order not found or expired from live queue.",
      });
    }

    const elapsedMs = Date.now() - order.createdAt;
    const totalDurationMs = order.estimatedReadyTime - order.createdAt;

    // Simulate auto status transitions
    let updatedStatus = order.status;
    if (elapsedMs > totalDurationMs) {
      updatedStatus = "ready_for_pickup";
    } else if (elapsedMs > 30000) {
      updatedStatus = "brewing";
    }
    order.status = updatedStatus;

    return NextResponse.json({
      success: true,
      order,
      remainingMinutes: Math.max(0, Math.ceil((order.estimatedReadyTime - Date.now()) / 60000)),
    });
  } catch (error: any) {
    console.error("[GET /api/cafe/orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to query order status", details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing required query parameter: orderId" },
        { status: 400 }
      );
    }

    const order = activeOrdersStore.get(orderId);
    if (!order) {
      return NextResponse.json(
        { error: "Order not found or expired from live queue." },
        { status: 404 }
      );
    }

    const elapsedMs = Date.now() - order.createdAt;
    const totalDurationMs = order.estimatedReadyTime - order.createdAt;
    if (elapsedMs > totalDurationMs) {
      order.status = "ready_for_pickup";
    } else if (elapsedMs > 15000 && order.status === "received") {
      order.status = "brewing";
    }

    if (order.status !== "received") {
      return NextResponse.json(
        { success: false, error: "Only orders that have not started brewing can be cancelled.", order },
        { status: 409 }
      );
    }

    order.status = "cancelled";
    activeOrdersStore.delete(orderId);
    return NextResponse.json({ success: true, order });
  } catch (error: any) {
    console.error("[DELETE /api/cafe/orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to cancel barista order", details: error.message },
      { status: 500 }
    );
  }
}
