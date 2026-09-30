/**
 * Tests for complete booking journey state machine.
 */

type BookingJourneyState =
  | "browsing"
  | "venue_selected"
  | "date_selected"
  | "seats_selected"
  | "review_order"
  | "payment"
  | "confirmed"
  | "cancelled";

interface JourneyTransition {
  from: BookingJourneyState;
  to: BookingJourneyState;
  trigger: string;
}

const VALID_TRANSITIONS: JourneyTransition[] = [
  { from: "browsing",        to: "venue_selected",  trigger: "select_venue"    },
  { from: "venue_selected",  to: "date_selected",   trigger: "select_date"     },
  { from: "date_selected",   to: "seats_selected",  trigger: "select_seats"    },
  { from: "seats_selected",  to: "review_order",    trigger: "review"          },
  { from: "review_order",    to: "payment",         trigger: "proceed_payment" },
  { from: "payment",         to: "confirmed",       trigger: "payment_success" },
  { from: "payment",         to: "cancelled",       trigger: "payment_failed"  },
  // Back transitions
  { from: "venue_selected",  to: "browsing",        trigger: "back"            },
  { from: "date_selected",   to: "venue_selected",  trigger: "back"            },
  { from: "seats_selected",  to: "date_selected",   trigger: "back"            },
  { from: "review_order",    to: "seats_selected",  trigger: "back"            },
];

function canTransition(
  from: BookingJourneyState,
  trigger: string
): BookingJourneyState | null {
  const transition = VALID_TRANSITIONS.find(
    (t) => t.from === from && t.trigger === trigger
  );
  return transition ? transition.to : null;
}

function isTerminalState(state: BookingJourneyState): boolean {
  return state === "confirmed" || state === "cancelled";
}

function progressPercent(state: BookingJourneyState): number {
  const order: BookingJourneyState[] = [
    "browsing", "venue_selected", "date_selected", "seats_selected",
    "review_order", "payment", "confirmed",
  ];
  const idx = order.indexOf(state);
  if (idx === -1) return 0;
  return Math.round((idx / (order.length - 1)) * 100);
}

describe("Venue booking journey state machine", () => {
  it("canTransition: browsing + select_venue → venue_selected", () => {
    expect(canTransition("browsing", "select_venue")).toBe("venue_selected");
  });

  it("canTransition: payment + payment_success → confirmed", () => {
    expect(canTransition("payment", "payment_success")).toBe("confirmed");
  });

  it("canTransition: invalid trigger → null", () => {
    expect(canTransition("browsing", "proceed_payment")).toBeNull();
  });

  it("canTransition: back from date_selected → venue_selected", () => {
    expect(canTransition("date_selected", "back")).toBe("venue_selected");
  });

  it("isTerminalState: confirmed → true", () => {
    expect(isTerminalState("confirmed")).toBe(true);
  });

  it("isTerminalState: cancelled → true", () => {
    expect(isTerminalState("cancelled")).toBe(true);
  });

  it("isTerminalState: payment → false", () => {
    expect(isTerminalState("payment")).toBe(false);
  });

  it("progressPercent: browsing = 0%", () => {
    expect(progressPercent("browsing")).toBe(0);
  });

  it("progressPercent: confirmed = 100%", () => {
    expect(progressPercent("confirmed")).toBe(100);
  });

  it("progressPercent: payment ≈ 83%", () => {
    expect(progressPercent("payment")).toBeGreaterThan(70);
  });
});
