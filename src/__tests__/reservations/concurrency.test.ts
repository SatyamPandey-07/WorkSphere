import { describe, it, expect, beforeEach } from "@jest/globals";
import { bookSeatWithAdvisoryLock } from "../../lib/reservations/bookingEngine";

describe("Booking Engine Concurrency Protection", () => {
  let mockPrisma: any;
  let lockState: boolean;

  beforeEach(() => {
    lockState = true;
    mockPrisma = {
      $transaction: async (callback: any) => {
        const tx = {
          $queryRaw: async (
            strings: TemplateStringsArray,
            ..._values: any[]
          ) => {
            const query = strings.join("?");
            if (query.includes("pg_try_advisory_xact_lock")) {
              if (lockState) {
                lockState = false; // Lock acquired by first caller
                return [{ acquired: true }];
              }
              return [{ acquired: false }];
            }
            if (query.includes("COUNT(*)")) {
              return [{ count: BigInt(0) }];
            }
            if (query.includes("INSERT INTO")) {
              return [{ id: "res_123", status: "CONFIRMED" }];
            }
            return [];
          },
        };
        return await callback(tx);
      },
    };
  });

  it("returns HTTP 409 conflict when advisory lock cannot be acquired", async () => {
    const seatId = "seat_404";
    const startTime = new Date("2026-12-01T10:00:00Z");
    const endTime = new Date("2026-12-01T12:00:00Z");

    const firstReq = await bookSeatWithAdvisoryLock(
      mockPrisma,
      seatId,
      "user_1",
      startTime,
      endTime,
    );
    expect(firstReq.success).toBe(true);

    const secondReq = await bookSeatWithAdvisoryLock(
      mockPrisma,
      seatId,
      "user_2",
      startTime,
      endTime,
    );
    expect(secondReq.success).toBe(false);
    expect(secondReq.isConflict).toBe(true);
    expect(secondReq.error).toBe(
      "Seat currently being reserved by another user",
    );
  });

  it("handles 50 simultaneous booking requests resulting in 1 success and 49 conflicts", async () => {
    const seatId = "seat_flash_sale";
    const startTime = new Date("2026-12-01T10:00:00Z");
    const endTime = new Date("2026-12-01T12:00:00Z");

    const requests = Array.from({ length: 50 }, (_, i) =>
      bookSeatWithAdvisoryLock(
        mockPrisma,
        seatId,
        `user_${i}`,
        startTime,
        endTime,
      ),
    );

    const results = await Promise.all(requests);
    const confirmed = results.filter((r) => r.success);
    const conflicts = results.filter((r) => r.isConflict);

    expect(confirmed.length).toBe(1);
    expect(conflicts.length).toBe(49);
  });
});
