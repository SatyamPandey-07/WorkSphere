/**
 * BaristaRoutingEngine
 * Calculates dynamic wait times and routes orders to specific barista stations
 * based on current queue depth, item complexity, and historical throughput.
 */

export interface MenuItem {
  id: string;
  name: string;
  basePrepTimeMs: number;
  complexityScore: number; // 1.0 to 5.0
}

export interface OrderPayload {
  orderId: string;
  items: MenuItem[];
  deskNumber: string;
  priority: 'NORMAL' | 'HIGH' | 'VIP';
  placedAt: number;
}

export interface BaristaStation {
  stationId: string;
  name: string;
  currentLoad: number; // Estimated milliseconds to clear current queue
  throughputFactor: number; // 0.8 to 1.2 (historical speed multiplier)
  isActive: boolean;
}

export interface RoutingDecision {
  orderId: string;
  assignedStationId: string;
  estimatedWaitMs: number;
  estimatedReadyAt: number;
  reasoning: string;
}

export class BaristaRoutingEngine {
  private stations: Map<string, BaristaStation>;
  private activeQueue: OrderPayload[];

  constructor(stations: BaristaStation[]) {
    this.stations = new Map(stations.map((s) => [s.stationId, { ...s }]));
    this.activeQueue = [];
  }

  public updateStationStatus(stationId: string, updates: Partial<BaristaStation>): void {
    const station = this.stations.get(stationId);
    if (station) {
      this.stations.set(stationId, { ...station, ...updates });
    }
  }

  public calculateItemPrepTime(item: MenuItem, station: BaristaStation): number {
    // Base time adjusted by station throughput and item complexity
    const complexityMultiplier = 1 + (item.complexityScore - 1) * 0.15;
    return (item.basePrepTimeMs * complexityMultiplier) / station.throughputFactor;
  }

  public calculateOrderPrepTime(order: OrderPayload, station: BaristaStation): number {
    // Parallel preparation assumption: max of individual items + 10% buffer for coordination
    const itemTimes = order.items.map((item) => this.calculateItemPrepTime(item, station));
    const maxItemTime = Math.max(...itemTimes);
    const coordinationBuffer = maxItemTime * 0.10;
    
    // Priority orders get a slight reduction in perceived wait due to expedited handling
    const priorityMultiplier = order.priority === 'HIGH' ? 0.85 : order.priority === 'VIP' ? 0.70 : 1.0;
    
    return Math.floor((maxItemTime + coordinationBuffer) * priorityMultiplier);
  }

  public evaluateRouting(order: OrderPayload): RoutingDecision {
    const activeStations = Array.from(this.stations.values()).filter((s) => s.isActive);
    
    if (activeStations.length === 0) {
      throw new Error('No active barista stations available for routing.');
    }

    let bestDecision: RoutingDecision | null = null;

    for (const station of activeStations) {
      const orderPrepTime = this.calculateOrderPrepTime(order, station);
      const totalWaitMs = station.currentLoad + orderPrepTime;
      const estimatedReadyAt = Date.now() + totalWaitMs;

      if (!bestDecision || totalWaitMs < bestDecision.estimatedWaitMs) {
        bestDecision = {
          orderId: order.orderId,
          assignedStationId: station.stationId,
          estimatedWaitMs: totalWaitMs,
          estimatedReadyAt,
          reasoning: `Routed to ${station.name} (Load: ${station.currentLoad}ms, Prep: ${orderPrepTime}ms)`
        };
      }
    }

    return bestDecision!;
  }

  public assignOrder(order: OrderPayload): RoutingDecision {
    const decision = this.evaluateRouting(order);
    
    // Update station load
    const station = this.stations.get(decision.assignedStationId);
    if (station) {
      station.currentLoad += this.calculateOrderPrepTime(order, station);
      this.stations.set(station.stationId, station);
    }

    this.activeQueue.push(order);
    return decision;
  }

  public completeOrder(orderId: string): void {
    const orderIndex = this.activeQueue.findIndex((o) => o.orderId === orderId);
    if (orderIndex !== -1) {
      const order = this.activeQueue[orderIndex];
      // Find which station it was assigned to (simplified: assume we track this in a real DB)
      // For this engine, we just decrement a generic load or rely on external state sync
      this.activeQueue.splice(orderIndex, 1);
    }
  }

  public getQueueDepth(): number {
    return this.activeQueue.length;
  }
}
