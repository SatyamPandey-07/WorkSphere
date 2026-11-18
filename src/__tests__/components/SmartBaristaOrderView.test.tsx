import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SmartBaristaOrderView from "@/components/cafe/SmartBaristaOrderView";
import type { CafeOrder } from "@/lib/cafe/smartCafeEngine";

const order: CafeOrder = {
  id: "order-123",
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
  estimatedReadyTime: Date.now() + 60000,
  pickupToken: "token",
  pickupCode: "1234",
  activeQueuePosition: 1,
};

describe("SmartBaristaOrderView cancellation", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("only calls the cancellation API after explicit confirmation", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, order }),
    });

    render(<SmartBaristaOrderView />);
    fireEvent.click(screen.getAllByRole("button", { name: /customize & add/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
    fireEvent.click(screen.getByRole("button", { name: /place pre-order/i }));

    await screen.findByText("ID: order-123");
    fireEvent.click(screen.getByRole("button", { name: "Cancel Order" }));

    expect(
      screen.getByText("Are you sure you want to cancel your barista order?")
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Keep Order" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText("Are you sure you want to cancel your barista order?")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel Order" }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, order: { ...order, status: "cancelled" } }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Yes, Cancel" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/cafe/orders?orderId=order-123");
    expect(fetchMock.mock.calls[1][1]).toEqual({ method: "DELETE" });
  });

  it("disables cancellation when the order is brewing", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, order: { ...order, status: "brewing" } }),
    });

    render(<SmartBaristaOrderView />);
    fireEvent.click(screen.getAllByRole("button", { name: /customize & add/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /add to cart/i }));
    fireEvent.click(screen.getByRole("button", { name: /place pre-order/i }));

    const cancelButton = await screen.findByRole("button", { name: "Cancel Order" });
    expect(cancelButton).toBeDisabled();
  });
});
