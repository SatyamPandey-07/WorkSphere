import {
  OrderBatchingEngine,
  MAX_LATENCY_GUARDRAIL_SECONDS,
  DEFAULT_SLIDING_WINDOW_SECONDS,
  type CafeOrder,
} from "@/core/queue/OrderBatchingEngine";

describe("OrderBatchingEngine (Cafe Queue Milk Steaming & Batch Optimization)", () => {
  let engine: OrderBatchingEngine;
  const baseTime = 1700000000000;

  beforeEach(() => {
    engine = new OrderBatchingEngine({
      slidingWindowSeconds: DEFAULT_SLIDING_WINDOW_SECONDS, // 240s
      maxWaitTimeSeconds: MAX_LATENCY_GUARDRAIL_SECONDS, // 420s
      maxBatchSize: 4,
    });
  });

  it("groups orders by milk type and brewing method to optimize steam wand turnaround", () => {
    // 3 orders placed within the 4-minute sliding window:
    // Order 1: Oat milk latte (t = 0s)
    // Order 2: Whole milk flat white (t = 10s)
    // Order 3: Oat milk cappuccino (t = 20s)
    const order1: CafeOrder = {
      orderId: "ord-1",
      customerId: "cust-1",
      placedAt: baseTime,
      items: [
        {
          id: "item-1",
          name: "Oat Latte",
          brewingMethod: "espresso",
          milkType: "oat",
          prepTimeSeconds: 60,
        },
      ],
    };

    const order2: CafeOrder = {
      orderId: "ord-2",
      customerId: "cust-2",
      placedAt: baseTime + 10000,
      items: [
        {
          id: "item-2",
          name: "Whole Flat White",
          brewingMethod: "espresso",
          milkType: "whole",
          prepTimeSeconds: 60,
        },
      ],
    };

    const order3: CafeOrder = {
      orderId: "ord-3",
      customerId: "cust-3",
      placedAt: baseTime + 20000,
      items: [
        {
          id: "item-3",
          name: "Oat Cappuccino",
          brewingMethod: "espresso",
          milkType: "oat",
          prepTimeSeconds: 60,
        },
      ],
    };

    engine.enqueueMany([order1, order2, order3]);

    const currentTime = baseTime + 60000; // 1 minute after start
    const batches = engine.generateBatches(currentTime);

    // Expect 2 batches: One for Oat milk (combining ord-1 & ord-3), one for Whole milk (ord-2)
    expect(batches).toHaveLength(2);

    // First batch should be oat milk because ord-1 is older than ord-2
    expect(batches[0].milkType).toBe("oat");
    expect(batches[0].orders.map((o) => o.orderId)).toEqual(["ord-1", "ord-3"]);

    // Second batch should be whole milk
    expect(batches[1].milkType).toBe("whole");
    expect(batches[1].orders.map((o) => o.orderId)).toEqual(["ord-2"]);
  });

  it("prioritizes orders reaching the 420-second (7-minute) maximum wait latency guardrail", () => {
    // Order A placed 430 seconds ago (exceeds 420s guardrail)
    const urgentOrder: CafeOrder = {
      orderId: "ord-urgent",
      customerId: "cust-vip",
      placedAt: baseTime - 430000, // 430s ago
      items: [
        {
          id: "item-u",
          name: "Almond Mocha",
          brewingMethod: "espresso",
          milkType: "almond",
        },
      ],
    };

    // Orders placed recently with oat milk
    const recentOat1: CafeOrder = {
      orderId: "ord-oat-1",
      customerId: "cust-o1",
      placedAt: baseTime - 60000,
      items: [
        {
          id: "item-o1",
          name: "Oat Latte",
          brewingMethod: "espresso",
          milkType: "oat",
        },
      ],
    };

    const recentOat2: CafeOrder = {
      orderId: "ord-oat-2",
      customerId: "cust-o2",
      placedAt: baseTime - 30000,
      items: [
        {
          id: "item-o2",
          name: "Oat Cortado",
          brewingMethod: "espresso",
          milkType: "oat",
        },
      ],
    };

    engine.enqueueMany([recentOat1, urgentOrder, recentOat2]);

    const batches = engine.generateBatches(baseTime);

    // The urgent order must be processed first to honor the 420s SLA
    expect(batches[0].isUrgent).toBe(true);
    expect(batches[0].orders[0].orderId).toBe("ord-urgent");

    // Followed by the grouped oat milk batch
    expect(batches[1].isUrgent).toBe(false);
    expect(batches[1].milkType).toBe("oat");
    expect(batches[1].orders).toHaveLength(2);
  });

  it("enforces FIFO sequence within the same milk type group", () => {
    const o1: CafeOrder = {
      orderId: "ord-1",
      customerId: "c1",
      placedAt: baseTime + 1000,
      items: [
        { id: "i1", name: "Oat 1", brewingMethod: "espresso", milkType: "oat" },
      ],
    };
    const o2: CafeOrder = {
      orderId: "ord-2",
      customerId: "c2",
      placedAt: baseTime + 5000,
      items: [
        { id: "i2", name: "Oat 2", brewingMethod: "espresso", milkType: "oat" },
      ],
    };
    const o3: CafeOrder = {
      orderId: "ord-3",
      customerId: "c3",
      placedAt: baseTime + 8000,
      items: [
        { id: "i3", name: "Oat 3", brewingMethod: "espresso", milkType: "oat" },
      ],
    };

    engine.enqueueMany([o3, o1, o2]); // Added out of order
    const sequence = engine.getOptimizedSequence(baseTime + 10000);

    // Must be sorted in FIFO order: ord-1, ord-2, ord-3
    expect(sequence.map((o) => o.orderId)).toEqual([
      "ord-1",
      "ord-2",
      "ord-3",
    ]);
  });

  it("splits batches when group size exceeds maxBatchSize", () => {
    const orders: CafeOrder[] = Array.from({ length: 6 }).map((_, i) => ({
      orderId: `batch-test-${i}`,
      customerId: `cust-${i}`,
      placedAt: baseTime + i * 1000,
      items: [
        {
          id: `item-${i}`,
          name: "Oat Drink",
          brewingMethod: "espresso",
          milkType: "oat",
        },
      ],
    }));

    engine.enqueueMany(orders);
    const batches = engine.generateBatches(baseTime + 10000);

    // With maxBatchSize = 4, 6 orders should form 2 batches (4 and 2)
    expect(batches).toHaveLength(2);
    expect(batches[0].orders).toHaveLength(4);
    expect(batches[1].orders).toHaveLength(2);
  });

  it("allows removing fulfilled orders from the queue", () => {
    const order: CafeOrder = {
      orderId: "remove-me",
      customerId: "cust-x",
      placedAt: baseTime,
      items: [
        {
          id: "it-x",
          name: "Cold Brew",
          brewingMethod: "cold_brew",
          milkType: "none",
        },
      ],
    };

    engine.enqueue(order);
    expect(engine.getPendingOrders()).toHaveLength(1);

    const removed = engine.removeOrder("remove-me");
    expect(removed).toBe(true);
    expect(engine.getPendingOrders()).toHaveLength(0);
  });
});
