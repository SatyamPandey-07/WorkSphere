/**
 * Tests for booking transfer between users.
 */

type TransferStatus = "requested" | "accepted" | "declined" | "cancelled" | "completed";

interface BookingTransfer {
  transferId: string;
  bookingId: string;
  fromUserId: string;
  toUserId: string;
  status: TransferStatus;
  requestedAt: number;
  responseDeadlineMs: number;
  completedAt: number | null;
  reason: string;
}

function isTransferExpired(transfer: BookingTransfer, nowMs: number): boolean {
  if (transfer.status !== "requested") return false;
  return nowMs >= transfer.responseDeadlineMs;
}

function canAcceptTransfer(transfer: BookingTransfer, userId: string, nowMs: number): boolean {
  if (transfer.toUserId !== userId) return false;
  if (transfer.status !== "requested") return false;
  if (isTransferExpired(transfer, nowMs)) return false;
  return true;
}

function acceptTransfer(transfer: BookingTransfer, nowMs: number): BookingTransfer {
  if (!canAcceptTransfer(transfer, transfer.toUserId, nowMs)) {
    throw new Error("Cannot accept transfer");
  }
  return { ...transfer, status: "completed", completedAt: nowMs };
}

function declineTransfer(transfer: BookingTransfer, userId: string): BookingTransfer {
  if (transfer.toUserId !== userId) throw new Error("Not the recipient");
  if (transfer.status !== "requested") throw new Error("Transfer not pending");
  return { ...transfer, status: "declined" };
}

function cancelTransfer(transfer: BookingTransfer, userId: string): BookingTransfer {
  if (transfer.fromUserId !== userId) throw new Error("Only sender can cancel");
  if (transfer.status === "completed") throw new Error("Cannot cancel completed transfer");
  return { ...transfer, status: "cancelled" };
}

const NOW = 1_700_000_000_000;
const TRANSFER: BookingTransfer = {
  transferId: "t1", bookingId: "b1",
  fromUserId: "u1", toUserId: "u2",
  status: "requested", requestedAt: NOW - 3600_000,
  responseDeadlineMs: NOW + 86_400_000,
  completedAt: null, reason: "Can't attend",
};

describe("Booking transfer requests", () => {
  it("isTransferExpired: within deadline → false", () => {
    expect(isTransferExpired(TRANSFER, NOW)).toBe(false);
  });

  it("isTransferExpired: past deadline → true", () => {
    expect(isTransferExpired(TRANSFER, NOW + 90_000_000)).toBe(true);
  });

  it("canAcceptTransfer: valid recipient → true", () => {
    expect(canAcceptTransfer(TRANSFER, "u2", NOW)).toBe(true);
  });

  it("canAcceptTransfer: wrong user → false", () => {
    expect(canAcceptTransfer(TRANSFER, "u1", NOW)).toBe(false);
  });

  it("acceptTransfer: sets completed", () => {
    const completed = acceptTransfer(TRANSFER, NOW);
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBe(NOW);
  });

  it("declineTransfer: sets declined", () => {
    expect(declineTransfer(TRANSFER, "u2").status).toBe("declined");
  });

  it("declineTransfer: wrong user throws", () => {
    expect(() => declineTransfer(TRANSFER, "u1")).toThrow("Not the recipient");
  });

  it("cancelTransfer: sender can cancel", () => {
    expect(cancelTransfer(TRANSFER, "u1").status).toBe("cancelled");
  });

  it("cancelTransfer: non-sender throws", () => {
    expect(() => cancelTransfer(TRANSFER, "u2")).toThrow("Only sender");
  });
});
