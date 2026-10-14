import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SmartBaristaOrderView from "@/components/cafe/SmartBaristaOrderView";
import type { CafeOrder } from "@/lib/cafe/smartCafeEngine";

const MINUTE = 60_000;

const baseOrder = (overrides: Partial<CafeOrder> = {}): CafeOrder => ({
  id: "order-countdown",
  venueId: "venue-1",
  venueName: "Test Cafe",
  customerName: "Alex",
  deskNumber: "Desk 14",
  items: [],
  subtotal: 5,
  tax: 0.44,
  total: 5.44,
  status: "received",
  createdAt: Date.now(),
  estimatedReadyTime: Date.now() + 4 * MINUTE,
  pickupToken: "token",
  pickupCode: "1234",
  activeQueuePosition: 1,
  ...overrides,
});

describe("SmartBaristaOrderView prep countdown", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  const placeOrder = async (order: CafeOrder) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, order }),
    });

    render(<SmartBaristaOrderView />);
    await user.click(
      screen.getAllByRole("button", { name: /customize & add/i })[0],
    );
    await user.click(screen.getByRole("button", { name: /add to cart/i }));
    await user.click(screen.getByRole("button", { name: /place pre-order/i }));
    await screen.findByText(`ID: ${order.id}`);
  };

  it("shows no countdown before an order is placed", () => {
    render(<SmartBaristaOrderView />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("shows the estimated time left on a received order", async () => {
    await placeOrder(baseOrder());
    expect(screen.getByRole("timer")).toHaveTextContent("Ready in ~4 mins");
  });

  it("keeps showing the countdown while the order is brewing", async () => {
    await placeOrder(baseOrder({ status: "brewing" }));
    expect(screen.getByRole("timer")).toHaveTextContent("Ready in ~4 mins");
  });

  it("hides the countdown once the order is ready for pickup", async () => {
    await placeOrder(baseOrder({ status: "ready_for_pickup" }));
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
