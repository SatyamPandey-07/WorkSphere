import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/components/venues/VenueSeatWaitlistModal", () => ({
  VenueSeatWaitlistModal: () => <div data-testid="mock-waitlist" />,
}));

import { BookingModal } from "@/components/bookings/BookingModal";
import {
  getOfflinePasscard,
  deleteOfflinePasscard,
} from "@/lib/security/offlinePasscardStore";
import * as store from "@/lib/security/offlinePasscardStore";
import {
  generateOfflinePasscardKeyPair,
  signOfflinePasscard,
} from "@/lib/security/offlineQrSigner";

const nowSeconds = Math.floor(Date.now() / 1000);
let token: string;
const originalFetch = global.fetch;

beforeAll(async () => {
  const pair = await generateOfflinePasscardKeyPair();
  token = await signOfflinePasscard(
    {
      bookingId: "bk-modal-1",
      userId: "user-1",
      venueId: "venue-1",
      validFrom: nowSeconds - 60,
      validUntil: nowSeconds + 3600,
      seatNumber: "D-4",
    },
    pair.privateKey,
  );
});

afterEach(async () => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
  await deleteOfflinePasscard("bk-modal-1");
});

function reserve(data: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data }),
  }) as unknown as typeof fetch;
  const onSuccess = jest.fn();
  render(
    <BookingModal
      venueId="venue-1"
      venueName="Basement Hub"
      onClose={jest.fn()}
      onSuccess={onSuccess}
    />,
  );
  fireEvent.change(
    document.getElementById("booking-date-input") as HTMLInputElement,
    {
      target: { value: "2027-01-15" },
    },
  );
  fireEvent.change(
    document.getElementById("booking-time-input") as HTMLInputElement,
    {
      target: { value: "09:00" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: /confirm|reserve|book/i,
      hidden: false,
    }),
  );
  return onSuccess;
}

describe("BookingModal keeps the signed offline passcard on confirmation (#7271)", () => {
  it("stores the token the server returned, then reports success", async () => {
    const onSuccess = reserve({
      confirmationId: "CONF-1",
      offlinePasscard: token,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("CONF-1"));
    expect(await getOfflinePasscard("bk-modal-1")).toBe(token);
  });

  it("still reports success when the booking comes back without a token", async () => {
    const onSuccess = reserve({ confirmationId: "CONF-2" });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("CONF-2"));
    expect(await getOfflinePasscard("bk-modal-1")).toBeNull();
  });

  it("still reports success when storing the token fails", async () => {
    jest
      .spyOn(store, "storeOfflinePasscardsFromBooking")
      .mockRejectedValue(new Error("quota exceeded"));
    const onSuccess = reserve({
      confirmationId: "CONF-3",
      offlinePasscard: token,
    });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("CONF-3"));
    expect(screen.queryByTestId("booking-error-alert")).not.toBeInTheDocument();
  });
});
