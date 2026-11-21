import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import DeskReservationCountdownTimer from "@/components/reservations/DeskReservationCountdownTimer";
import { useDeskReservationCountdown } from "@/hooks/useDeskReservationCountdown";
import type { UseDeskReservationCountdownReturn } from "@/hooks/useDeskReservationCountdown";

jest.mock("@/hooks/useDeskReservationCountdown", () => ({
  useDeskReservationCountdown: jest.fn(),
}));

const mockedUseCountdown = useDeskReservationCountdown as jest.MockedFunction<
  typeof useDeskReservationCountdown
>;

const EXPIRY = 1_000_000_000;

const createCountdownState = (
  overrides: Partial<UseDeskReservationCountdownReturn> = {},
): UseDeskReservationCountdownReturn => {
  const remainingSeconds = overrides.remainingSeconds ?? 301;

  return {
    remainingSeconds,
    formattedTime: `${Math.floor(remainingSeconds / 60)
      .toString()
      .padStart(2, "0")}:${(remainingSeconds % 60)
      .toString()
      .padStart(2, "0")}`,
    progressPercentage: 100,
    isExpiringSoon: false,
    isExpired: false,
    isActive: true,
    isLiveSyncActive: false,
    expiresAt: EXPIRY,
    extendCountdown: jest.fn().mockResolvedValue(true),
    releaseCountdown: jest.fn().mockResolvedValue(true),
    syncWithServer: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
};

const props = {
  venueId: "venue-1",
  deskId: "desk-1",
  deskName: "Desk 14",
};

describe("DeskReservationCountdownTimer accessibility", () => {
  beforeEach(() => {
    mockedUseCountdown.mockReset();
  });

  const renderTimer = (initialState: UseDeskReservationCountdownReturn) => {
    mockedUseCountdown.mockReturnValue(initialState);

    const view = render(<DeskReservationCountdownTimer {...props} />);

    const updateState = (state: UseDeskReservationCountdownReturn) => {
      mockedUseCountdown.mockReturnValue(state);
      view.rerender(<DeskReservationCountdownTimer {...props} />);
    };

    return { ...view, updateState };
  };

  it("keeps the continuously updating timer out of the polite live region", () => {
    const { container } = renderTimer(createCountdownState());

    expect(screen.getByRole("timer")).toHaveAttribute("aria-live", "off");

    const liveRegion = container.querySelector('[aria-live="polite"]');

    expect(liveRegion).toHaveClass("sr-only");
  });

  it("announces each countdown milestone once", () => {
    const { container, updateState } = renderTimer(createCountdownState());

    const liveRegion = container.querySelector('[aria-live="polite"]');

    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent("");

    updateState(createCountdownState({ remainingSeconds: 300 }));
    expect(liveRegion).toHaveTextContent(
      "5 minutes remaining on your seat hold.",
    );

    updateState(createCountdownState({ remainingSeconds: 299 }));
    expect(liveRegion).toHaveTextContent(
      "5 minutes remaining on your seat hold.",
    );

    updateState(createCountdownState({ remainingSeconds: 120 }));
    expect(liveRegion).toHaveTextContent(
      "2 minutes remaining on your seat hold.",
    );

    updateState(createCountdownState({ remainingSeconds: 60 }));
    expect(liveRegion).toHaveTextContent(
      "1 minute remaining on your seat hold.",
    );

    updateState(createCountdownState({ remainingSeconds: 30 }));
    expect(liveRegion).toHaveTextContent(
      "30 seconds remaining on your seat hold.",
    );
  });

  it("combines crossed milestones into one announcement when countdown updates are skipped", () => {
    const { container, updateState } = renderTimer(createCountdownState());

    const liveRegion = container.querySelector('[aria-live="polite"]');

    updateState(createCountdownState({ remainingSeconds: 29 }));

    expect(liveRegion).toHaveTextContent(
      "5 minutes remaining on your seat hold. 2 minutes remaining on your seat hold. 1 minute remaining on your seat hold. 30 seconds remaining on your seat hold.",
    );
  });

  it("announces expiration assertively", () => {
    mockedUseCountdown.mockReturnValue(
      createCountdownState({
        remainingSeconds: 0,
        expiresAt: null,
        isActive: false,
        isExpired: true,
      }),
    );

    render(<DeskReservationCountdownTimer {...props} />);

    const alert = screen.getByRole("alert");

    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert).toHaveAttribute("aria-atomic", "true");
    expect(alert).toHaveTextContent("Seat hold has expired.");
  });
});
