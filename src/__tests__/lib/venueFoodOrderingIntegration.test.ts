/**
 * Tests for venue food ordering integration with booking.
 */

type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "cancelled";

interface FoodOrder {
  orderId: string;
  bookingId: string;
  userId: string;
  venueId: string;
  items: { name: string; quantity: number; priceCents: number }[];
  status: OrderStatus;
  orderTime: number;
  deliveryTime: number;
  totalCents: number;
  prepTimeMinutes: number;
}

function orderTotal(order: FoodOrder): number {
  return order.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
}

function isOrderLate(order: FoodOrder, nowMs: number): boolean {
  if (order.status === "delivered" || order.status === "cancelled") return false;
  const expectedDeliveryMs = order.orderTime + order.prepTimeMinutes * 60_000;
  return nowMs > expectedDeliveryMs && order.deliveryTime > nowMs;
}

function advanceOrderStatus(order: FoodOrder, nowMs: number): FoodOrder {
  const transitions: Partial<Record<OrderStatus, OrderStatus>> = {
    pending: "confirmed", confirmed: "preparing", preparing: "ready", ready: "delivered",
  };
  const nextStatus = transitions[order.status];
  if (!nextStatus) return order;
  return { ...order, status: nextStatus, ...(nextStatus === "delivered" ? { deliveryTime: nowMs } : {}) };
}

function cancelOrder(order: FoodOrder): FoodOrder {
  if (order.status === "delivered") throw new Error("Cannot cancel delivered order");
  if (order.status === "cancelled") return order;
  return { ...order, status: "cancelled" };
}

function totalOrderedByUser(orders: FoodOrder[], userId: string): number {
  return orders
    .filter((o) => o.userId === userId && o.status !== "cancelled")
    .reduce((sum, o) => sum + orderTotal(o), 0);
}

const NOW = 1_700_000_000_000;
const ORDER: FoodOrder = {
  orderId: "fo1", bookingId: "b1", userId: "u1", venueId: "v1",
  items: [
    { name: "Coffee", quantity: 2, priceCents: 350 },
    { name: "Sandwich", quantity: 1, priceCents: 800 },
  ],
  status: "confirmed", orderTime: NOW - 10 * 60_000,
  deliveryTime: NOW + 20 * 60_000, totalCents: 1500,
  prepTimeMinutes: 15,
};

describe("Venue food ordering integration", () => {
  it("orderTotal: 2×350 + 1×800 = 1500", () => {
    expect(orderTotal(ORDER)).toBe(1500);
  });

  it("advanceOrderStatus: confirmed → preparing", () => {
    expect(advanceOrderStatus(ORDER, NOW).status).toBe("preparing");
  });

  it("advanceOrderStatus: delivered → no change", () => {
    const delivered = { ...ORDER, status: "delivered" as OrderStatus };
    expect(advanceOrderStatus(delivered, NOW).status).toBe("delivered");
  });

  it("cancelOrder: confirmed → cancelled", () => {
    expect(cancelOrder(ORDER).status).toBe("cancelled");
  });

  it("cancelOrder: delivered → throws", () => {
    const delivered = { ...ORDER, status: "delivered" as OrderStatus };
    expect(() => cancelOrder(delivered)).toThrow("Cannot cancel");
  });

  it("isOrderLate: prep done but not delivered → false (within prep time)", () => {
    const recent = { ...ORDER, orderTime: NOW - 5 * 60_000 };
    expect(isOrderLate(recent, NOW)).toBe(false);
  });

  it("totalOrderedByUser: excludes cancelled orders", () => {
    const orders = [ORDER, { ...ORDER, orderId: "fo2", status: "cancelled" as OrderStatus }];
    expect(totalOrderedByUser(orders, "u1")).toBe(1500);
  });
});
