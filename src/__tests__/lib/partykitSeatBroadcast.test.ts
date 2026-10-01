/**
 * Tests for PartyKit seat update broadcast protocol.
 */

interface SeatUpdateMessage {
  type: "seat_update";
  venueId: string;
  count: number;
  capacity: number;
  status: "green" | "yellow" | "red";
  epoch?: number;
  sequenceId?: number;
}

function computeSeatStatus(count: number, capacity: number): "green" | "yellow" | "red" {
  if (capacity <= 0) return "green";
  const ratio = count / capacity;
  if (ratio < 0.5) return "green";
  if (ratio < 0.8) return "yellow";
  return "red";
}

function shouldAcceptMessage(
  msg: SeatUpdateMessage,
  currentEpoch: number,
  currentSeq: number,
): boolean {
  const msgEpoch = msg.epoch ?? 0;
  const msgSeq = msg.sequenceId ?? 0;
  if (msgEpoch < currentEpoch) return false;
  if (msgEpoch === currentEpoch && msgSeq <= currentSeq) return false;
  return true;
}

describe("PartyKit seat update broadcast", () => {
  it("computeSeatStatus: <50% = green", () => {
    expect(computeSeatStatus(3, 8)).toBe("green");
  });

  it("computeSeatStatus: 50-79% = yellow", () => {
    expect(computeSeatStatus(5, 8)).toBe("yellow"); // 62.5%
  });

  it("computeSeatStatus: >=80% = red", () => {
    expect(computeSeatStatus(7, 8)).toBe("red"); // 87.5%
  });

  it("computeSeatStatus: capacity 0 = green (guard)", () => {
    expect(computeSeatStatus(5, 0)).toBe("green");
  });

  it("shouldAcceptMessage: higher epoch accepted", () => {
    const msg: SeatUpdateMessage = { type: "seat_update", venueId: "v1", count: 3, capacity: 8, status: "green", epoch: 2, sequenceId: 1 };
    expect(shouldAcceptMessage(msg, 1, 5)).toBe(true);
  });

  it("shouldAcceptMessage: lower epoch rejected", () => {
    const msg: SeatUpdateMessage = { type: "seat_update", venueId: "v1", count: 3, capacity: 8, status: "green", epoch: 1, sequenceId: 5 };
    expect(shouldAcceptMessage(msg, 2, 1)).toBe(false);
  });

  it("shouldAcceptMessage: same epoch, higher seq accepted", () => {
    const msg: SeatUpdateMessage = { type: "seat_update", venueId: "v1", count: 3, capacity: 8, status: "green", epoch: 1, sequenceId: 6 };
    expect(shouldAcceptMessage(msg, 1, 5)).toBe(true);
  });

  it("shouldAcceptMessage: same epoch, same seq rejected (duplicate)", () => {
    const msg: SeatUpdateMessage = { type: "seat_update", venueId: "v1", count: 3, capacity: 8, status: "green", epoch: 1, sequenceId: 5 };
    expect(shouldAcceptMessage(msg, 1, 5)).toBe(false);
  });
});
