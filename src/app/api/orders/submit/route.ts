/**
 * POST /api/orders/submit
 * Validates cart payloads, initializes the order state machine,
 * routes to the barista engine, and pushes to the PartyKit room.
 */

import { NextRequest, NextResponse } from 'next/server';
import { OrderStateMachine, OrderStatus, UserRole } from '@/core/queue/OrderStateMachine';
import { BaristaRoutingEngine, OrderPayload, MenuItem } from '@/core/queue/BaristaRoutingEngine';

// Mocked dependencies for demonstration (would be DB/Redis in production)
const mockMenu: Record<string, MenuItem> = {
  'espresso': { id: 'espresso', name: 'Espresso', basePrepTimeMs: 45000, complexityScore: 1.2 },
  'latte': { id: 'latte', name: 'Caffe Latte', basePrepTimeMs: 90000, complexityScore: 2.5 },
  'pourover': { id: 'pourover', name: 'Pour Over', basePrepTimeMs: 240000, complexityScore: 4.8 }
};

const mockStations = [
  { stationId: 'st-1', name: 'Main Espresso Machine', currentLoad: 0, throughputFactor: 1.1, isActive: true },
  { stationId: 'st-2', name: 'Manual Brew Bar', currentLoad: 0, throughputFactor: 0.9, isActive: true }
];

const routingEngine = new BaristaRoutingEngine(mockStations);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items, deskNumber, userId } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart must contain at least one item.' }, { status: 400 });
    }

    if (!deskNumber || typeof deskNumber !== 'string') {
      return NextResponse.json({ error: 'Valid desk number is required.' }, { status: 400 });
    }

    // 1. Validate and Map Items
    const mappedItems: MenuItem[] = [];
    for (const itemId of items) {
      const menuItem = mockMenu[itemId];
      if (!menuItem) {
        return NextResponse.json({ error: `Invalid item ID: ${itemId}` }, { status: 400 });
      }
      mappedItems.push(menuItem);
    }

    // 2. Create Order ID and Initial State
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const initialState = OrderStateMachine.createInitialOrder(orderId);
    const machine = new OrderStateMachine(initialState);

    // 3. Route to Barista
    const orderPayload: OrderPayload = {
      orderId,
      items: mappedItems,
      deskNumber,
      priority: 'NORMAL', // Could be determined by user tier
      placedAt: Date.now()
    };

    const routingDecision = routingEngine.assignOrder(orderPayload);

    // 4. Transition to BREWING (Simulating immediate barista acceptance for demo)
    // In reality, this might stay PLACED until a barista explicitly claims it.
    const brewingState = machine.transition(OrderStatus.BREWING, UserRole.SYSTEM, {
      stationId: routingDecision.assignedStationId,
      estimatedReadyAt: routingDecision.estimatedReadyAt
    });

    // 5. Push to PartyKit Room (Mocked HTTP call to PartyKit REST API)
    const partyKitRoomId = process.env.PARTYKIT_ROOM_ID || 'main-cafe';
    const partyKitBaseUrl = process.env.PARTYKIT_BASE_URL || 'https://worksphere.partykit.dev';
    
    // Note: In a real app, use the PartyKit SDK or fetch to the room's REST endpoint
    console.log(`[API] Pushing order ${orderId} to PartyKit room ${partyKitRoomId}`);
    
    // Mocking the notification scheduling
    console.log(`[API] Scheduling notification for ${new Date(routingDecision.estimatedReadyAt).toISOString()}`);

    return NextResponse.json({
      success: true,
      orderId: brewingState.orderId,
      status: brewingState.status,
      estimatedReadyAt: routingDecision.estimatedReadyAt,
      assignedStation: routingDecision.assignedStationId,
      deskNumber
    }, { status: 201 });

  } catch (error: any) {
    console.error('[API] Order submission failed:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
