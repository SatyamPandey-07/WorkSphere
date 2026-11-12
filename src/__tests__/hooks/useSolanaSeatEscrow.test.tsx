/**
 * Tests for useSolanaSeatEscrow hook.
 */

import { renderHook, act } from "@testing-library/react";
import { useSolanaSeatEscrow } from "@/hooks/useSolanaSeatEscrow";
import { resetSeatReservations } from "@/lib/solana/solanaPayEscrow";
import type { Connection } from "@solana/web3.js";

describe("useSolanaSeatEscrow Hook (#7169)", () => {
  let mockConnection: Partial<Connection>;
  let callbacks: Map<string, (res: any, ctx: any) => void>;

  beforeEach(() => {
    resetSeatReservations();
    jest.useFakeTimers();
    callbacks = new Map();
    mockConnection = {
      onSignatureWithOptions: jest.fn().mockImplementation(
        (sig: string, cb: any, options: { commitment: string }) => {
          callbacks.set(options.commitment, cb);
          return 101;
        },
      ),
      removeSignatureListener: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    resetSeatReservations();
    jest.useRealTimers();
  });

  it("initializes with available state and updates optimistically on reservation", async () => {
    const { result } = renderHook(() => useSolanaSeatEscrow());

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.seatState).toBe("available");

    await act(async () => {
      await result.current.reserveSeat({
        connection: mockConnection as Connection,
        seatId: "seat-hook-1",
        venueId: "venue-hook-1",
        signature: "sig-hook-1",
        payerWallet: "wallet-hook-1",
        amount: 0.1,
      });
    });

    expect(result.current.isProvisionallyReserved).toBe(true);
    expect(result.current.seatState).toBe("provisionally_reserved");
    expect(result.current.paymentStatus).toBe("pending");
  });

  it("updates to confirmed when confirmation callback arrives", async () => {
    const { result } = renderHook(() => useSolanaSeatEscrow());

    await act(async () => {
      await result.current.reserveSeat({
        connection: mockConnection as Connection,
        seatId: "seat-hook-2",
        venueId: "venue-hook-2",
        signature: "sig-hook-2",
        payerWallet: "wallet-hook-2",
        amount: 0.2,
      });
    });

    act(() => {
      callbacks.get("confirmed")?.({ err: null }, { slot: 999 });
    });

    expect(result.current.isConfirmed).toBe(true);
    expect(result.current.seatState).toBe("confirmed");
    expect(result.current.paymentStatus).toBe("confirmed");
  });

  it("rolls back to available with error message when on-chain error occurs", async () => {
    const { result } = renderHook(() => useSolanaSeatEscrow());

    await act(async () => {
      await result.current.reserveSeat({
        connection: mockConnection as Connection,
        seatId: "seat-hook-3",
        venueId: "venue-hook-3",
        signature: "sig-hook-3",
        payerWallet: "wallet-hook-3",
        amount: 0.3,
      });
    });

    act(() => {
      callbacks.get("confirmed")?.({ err: "Simulation failure" }, { slot: 999 });
    });

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.seatState).toBe("available");
    expect(result.current.paymentStatus).toBe("failed");
    expect(result.current.error).toContain("Simulation failure");
  });
});
