/**
 * @jest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import ReservationClient from "@/app/reserve/[venueId]/reservation-client";
import { apiFetch } from "@/lib/apiClient";

jest.mock("@/lib/apiClient", () => ({ apiFetch: jest.fn() }));

jest.mock("@/hooks/useRateLimit", () => ({ useRateLimit: () => 0 }));

jest.mock("@/hooks/useSeatHoldLock", () => {
  // A stable object per module: the component memoizes loadAvailability on
  // releaseHold, so returning fresh jest.fn()s on every render would make the
  // availability effect re-subscribe indefinitely.
  const lock = {
    activeHolds: {},
    myHeldSeatId: null,
    remainingSeconds: 0,
    acquireHold: async () => true,
    releaseHold: async () => undefined,
    confirmCheckout: async () => undefined,
    isSeatHeldByOther: () => false,
  };
  return { useSeatHoldLock: () => lock };
});

jest.mock("@/components/floorplan/FloorPlanViewer3D", () => ({
  __esModule: true,
  default: ({
    seats,
    onSelectSeat,
  }: {
    seats: { id: string; seatNumber: string; available: boolean }[];
    onSelectSeat: (id: string | null) => void;
  }) => (
    <div data-testid="floor-plan">
      {seats
        .filter((seat) => seat.available)
        .map((seat) => (
          <button
            key={seat.id}
            type="button"
            onClick={() => onSelectSeat(seat.id)}
          >
            {seat.seatNumber}
          </button>
        ))}
    </div>
  ),
}));

jest.mock("@/components/GuestsInput", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/components/venue/SeatOccupancyHeatmap", () => ({
  SeatOccupancyHeatmap: () => null,
}));
jest.mock("@/components/venue/VenueLiveVibeWidget", () => ({
  VenueLiveVibeWidget: () => null,
}));
jest.mock("@/components/bookings/CopyBookingReferenceButton", () => ({
  CopyBookingReferenceButton: () => null,
}));
jest.mock("@/components/bookings/RescheduleModal", () => ({
  RescheduleModal: () => null,
}));
jest.mock("@/components/reservations/DeskReservationCountdownTimer", () => ({
  DeskReservationCountdownTimer: () => null,
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const VENUE = {
  id: "venue-1",
  name: "Test Venue",
  address: "1 Test Street",
  category: "office",
};

const SEATS = [
  {
    id: "seat-1",
    seatNumber: "A-01",
    type: "HOT_DESK",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    amenities: [],
    available: true,
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function selectSeat() {
  const seatButton = await screen.findByRole("button", { name: "A-01" });
  await act(async () => {
    fireEvent.click(seatButton);
  });
}

async function submitTwice() {
  const form = screen.getByTestId("confirm-booking-btn").closest("form");
  if (!form) throw new Error("confirm button is not inside a form");
  // Both events are dispatched inside one act() scope so React has not
  // committed the disabled state between them. This is the double-click window
  // from #7735: without a synchronous guard both calls reach apiFetch.
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  return form;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ seats: SEATS }),
  })) as unknown as typeof fetch;
  (global as unknown as { EventSource: unknown }).EventSource = class {
    addEventListener() {}
    removeEventListener() {}
    close() {}
  };
  // The component's <style jsx global> block forwards `jsx`/`global` to the DOM
  // under jsdom. Harmless, and unrelated to this suite, so keep the output clean
  // without hiding any other console error.
  const originalError = console.error.bind(console);
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = String(args[0] ?? "");
    if (
      message.includes("non-boolean attribute `jsx`") ||
      message.includes("non-boolean attribute `global`")
    ) {
      return;
    }
    originalError(...args);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("recurring reservation double-submit guard", () => {
  it("sends one request for two submits dispatched before the first render commits", async () => {
    const pending = deferred<Response>();
    mockApiFetch.mockReturnValueOnce(pending.promise);

    render(<ReservationClient venue={VENUE} />);
    await selectSeat();
    fireEvent.click(screen.getByText("Recurring booking").closest("button")!);

    const button = screen.getByTestId("confirm-booking-btn");
    expect(button).not.toBeDisabled();

    await submitTwice();

    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/reservations/recurring-book",
      expect.objectContaining({ method: "POST" }),
    );

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("confirm-booking-spinner")).toBeInTheDocument();
    expect(screen.getByText("Securing workspace...")).toBeInTheDocument();

    await act(async () => {
      pending.resolve({
        ok: true,
        json: async () => ({ booked: 12, skipped: 0 }),
      } as Response);
      await pending.promise;
    });

    await waitFor(() =>
      expect(
        screen.getByText(/12 recurring booking\(s\) confirmed/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("confirm-booking-spinner"),
    ).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("accepts a new submission once the previous one has settled", async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ confirmationId: "ref-1" }),
    } as Response);

    render(<ReservationClient venue={VENUE} />);
    await selectSeat();
    await submitTwice();
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));

    await selectSeat();
    await submitTwice();

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
    expect(mockApiFetch).toHaveBeenLastCalledWith(
      "/api/reservations/book",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("releases the guard when the request rejects", async () => {
    mockApiFetch.mockRejectedValueOnce(new Error("network down"));

    render(<ReservationClient venue={VENUE} />);
    await selectSeat();
    await submitTwice();

    await waitFor(() =>
      expect(screen.getByText("network down")).toBeInTheDocument(),
    );
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ confirmationId: "ref-2" }),
    } as Response);

    await submitTwice();
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(2));
  });

  it("does not post when validation fails, but still allows a later valid submit", async () => {
    render(<ReservationClient venue={VENUE} />);
    // Wait for availability so the failure comes from "no seat selected"
    // rather than the separate zero-capacity guard.
    await screen.findByRole("button", { name: "A-01" });
    const form = screen.getByTestId("confirm-booking-btn").closest("form")!;

    await act(async () => {
      fireEvent.submit(form);
    });

    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(
      screen.getByText("Choose an available desk or room first."),
    ).toBeInTheDocument();

    mockApiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ confirmationId: "ref-3" }),
    } as Response);

    await selectSeat();
    await submitTwice();
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
