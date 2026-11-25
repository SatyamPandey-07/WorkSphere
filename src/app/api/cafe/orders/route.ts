/**
 * route.ts
 * /api/cafe/orders
 * Handles persistent order creation, dynamic queue wait-time estimation, and authenticated order lifecycle.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  SmartCafeEngine,
  SAMPLE_CAFE_MENU,
  OrderItemInput,
} from "@/lib/cafe/smartCafeEngine";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const itemsInput: OrderItemInput[] = body.items || [];
    const customerName = body.customerName || "Nomad Professional";
    const deskNumber = body.deskNumber || "Desk #14B";
    const venueId = body.venueId || "venue-sf-01";
    const venueName = body.venueName || "SoMa Focus Hub & Artisan Roastery";

    if (!Array.isArray(itemsInput) || itemsInput.length === 0) {
      return NextResponse.json(
        { error: "Order must contain at least one item." },
        { status: 400 },
      );
    }

    // Determine current active orders in queue at venue
    const activeQueueLength = await prisma.cafeOrder.count({
      where: {
        venueId,
        status: { in: ["received", "brewing"] },
      },
    });

    const calculation = SmartCafeEngine.calculateOrderDetails(
      itemsInput,
      SAMPLE_CAFE_MENU,
      activeQueueLength + 1,
    );

    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const { pickupCode, pickupToken } =
      SmartCafeEngine.generatePickupTokens(orderId);

    const estimatedReadyTime = new Date(
      Date.now() + calculation.estimatedPrepMinutes * 60 * 1000,
    );

    const newOrder = await prisma.cafeOrder.create({
      data: {
        id: orderId,
        venueId,
        venueName,
        userId,
        customerName,
        deskNumber,
        items: calculation.calculatedItems as unknown as Prisma.InputJsonValue,
        subtotal: calculation.subtotal,
        tax: calculation.tax,
        total: calculation.total,
        status: "received",
        pickupCode,
        pickupToken,
        estimatedReadyTime,
      },
    });

    return NextResponse.json({
      success: true,
      order: {
        ...newOrder,
        createdAt: newOrder.createdAt.getTime(),
        estimatedReadyTime: newOrder.estimatedReadyTime.getTime(),
        activeQueuePosition: activeQueueLength + 1,
      },
      estimatedMinutes: calculation.estimatedPrepMinutes,
    });
  } catch (error: any) {
    console.error("[POST /api/cafe/orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to place mobile barista order", details: error.message },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing required query parameter: orderId" },
        { status: 400 },
      );
    }

    const order = await prisma.cafeOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found or expired from live queue." },
        { status: 404 },
      );
    }

    // Verify ownership
    if (order.userId !== userId) {
      return NextResponse.json(
        {
          error: "Forbidden: Cannot access an order belonging to another user",
        },
        { status: 403 },
      );
    }

    const remainingMinutes = Math.max(
      0,
      Math.ceil(
        (new Date(order.estimatedReadyTime).getTime() - Date.now()) / 60000,
      ),
    );

    return NextResponse.json({
      success: true,
      order: {
        ...order,
        createdAt: order.createdAt.getTime(),
        estimatedReadyTime: order.estimatedReadyTime.getTime(),
      },
      remainingMinutes,
    });
  } catch (error: any) {
    console.error("[GET /api/cafe/orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to query order status", details: error.message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId");

    if (!orderId) {
      return NextResponse.json(
        { error: "Missing required query parameter: orderId" },
        { status: 400 },
      );
    }

    const order = await prisma.cafeOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found or expired from live queue." },
        { status: 404 },
      );
    }

    // Verify ownership
    if (order.userId !== userId) {
      return NextResponse.json(
        {
          error: "Forbidden: Cannot cancel an order belonging to another user",
        },
        { status: 403 },
      );
    }

    if (order.status !== "received") {
      return NextResponse.json(
        {
          success: false,
          error: "Only orders that have not started brewing can be cancelled.",
          order: {
            ...order,
            createdAt: order.createdAt.getTime(),
            estimatedReadyTime: order.estimatedReadyTime.getTime(),
          },
        },
        { status: 409 },
      );
    }

    const updated = await prisma.cafeOrder.update({
      where: { id: orderId },
      data: { status: "cancelled" },
    });

    return NextResponse.json({
      success: true,
      order: {
        ...updated,
        createdAt: updated.createdAt.getTime(),
        estimatedReadyTime: updated.estimatedReadyTime.getTime(),
      },
    });
  } catch (error: any) {
    console.error("[DELETE /api/cafe/orders] Error:", error);
    return NextResponse.json(
      { error: "Failed to cancel barista order", details: error.message },
      { status: 500 },
    );
  }
}
