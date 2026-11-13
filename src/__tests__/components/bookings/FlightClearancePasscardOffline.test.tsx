import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("html-to-image", () => ({ toPng: jest.fn() }), { virtual: true });

jest.mock(
  "qrcode.react",
  () => ({
    QRCodeSVG: ({
      value,
      size,
      level,
    }: {
      value: string;
      size: number;
      level: string;
    }) => (
      <div
        data-testid="mock-qrcode"
        data-value={value}
        data-size={size}
        data-level={level}
      />
    ),
  }),
  { virtual: true },
);

import { FlightClearancePasscard } from "@/components/bookings/FlightClearancePasscard";
import {
  saveOfflinePasscard,
  deleteOfflinePasscard,
} from "@/lib/security/offlinePasscardStore";
import {
  generateOfflinePasscardKeyPair,
  signOfflinePasscard,
  verifyOfflinePasscard,
  type OfflinePasscardPayload,
} from "@/lib/security/offlineQrSigner";

const nowSeconds = Math.floor(Date.now() / 1000);
const payload: OfflinePasscardPayload = {
  bookingId: "bk-ui-1",
  userId: "user-ui",
  venueId: "venue-ui",
  validFrom: nowSeconds - 3600,
  validUntil: nowSeconds + 3600,
  seatNumber: "C-7",
};

let pair: CryptoKeyPair;
let token: string;

beforeAll(async () => {
  pair = await generateOfflinePasscardKeyPair();
  token = await signOfflinePasscard(payload, pair.privateKey);
});

afterEach(async () => {
  await deleteOfflinePasscard(payload.bookingId);
});

const qr = () => screen.getByTestId("mock-qrcode");

describe("FlightClearancePasscard offline signed QR (#7271)", () => {
  it("keeps the online verify link when there is no signed token", () => {
    render(<FlightClearancePasscard isOpen onClose={jest.fn()} />);
    expect(qr().getAttribute("data-value")).toMatch(
      /^https:\/\/workspace\.sector\.command\/verify\?code=/,
    );
    expect(qr().getAttribute("data-level")).toBe("H");
    expect(screen.getByTestId("flight-clearance-qrcode")).toHaveAttribute(
      "data-qr-mode",
      "online-link",
    );
    expect(
      screen.queryByTestId("flight-clearance-offline-badge"),
    ).not.toBeInTheDocument();
  });

  it("draws the signed token as the QR when one is passed in", () => {
    render(
      <FlightClearancePasscard
        isOpen
        onClose={jest.fn()}
        offlineToken={token}
      />,
    );
    expect(qr().getAttribute("data-value")).toBe(token);
    expect(screen.getByTestId("flight-clearance-qrcode")).toHaveAttribute(
      "data-qr-mode",
      "offline-signed",
    );
    expect(
      screen.getByTestId("flight-clearance-offline-badge"),
    ).toBeInTheDocument();
  });

  it("draws a token that verifies against the venue public key, which is what a scanner checks offline", async () => {
    render(
      <FlightClearancePasscard
        isOpen
        onClose={jest.fn()}
        offlineToken={token}
      />,
    );
    const scanned = qr().getAttribute("data-value") as string;
    expect((await verifyOfflinePasscard(scanned, pair.publicKey)).valid).toBe(
      true,
    );
  });

  it("loads the token saved at booking confirmation from IndexedDB, with no network", async () => {
    await saveOfflinePasscard(token);
    render(
      <FlightClearancePasscard
        isOpen
        onClose={jest.fn()}
        bookingId={payload.bookingId}
      />,
    );
    await waitFor(() => expect(qr().getAttribute("data-value")).toBe(token));
    expect(
      screen.getByTestId("flight-clearance-offline-badge"),
    ).toBeInTheDocument();
  });

  it("falls back to the online link when nothing is stored for the booking", async () => {
    render(
      <FlightClearancePasscard
        isOpen
        onClose={jest.fn()}
        bookingId="bk-not-stored"
      />,
    );
    // give the lookup time to finish, then confirm it stayed on the link
    await waitFor(() =>
      expect(screen.getByTestId("flight-clearance-qrcode")).toHaveAttribute(
        "data-qr-mode",
        "online-link",
      ),
    );
    expect(qr().getAttribute("data-value")).toMatch(/verify\?code=/);
  });

  it("does not use a stored token that has expired", async () => {
    const expired = await signOfflinePasscard(
      {
        ...payload,
        validFrom: nowSeconds - 7200,
        validUntil: nowSeconds - 3600,
      },
      pair.privateKey,
    );
    await saveOfflinePasscard(expired);
    render(
      <FlightClearancePasscard
        isOpen
        onClose={jest.fn()}
        bookingId={payload.bookingId}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("flight-clearance-qrcode")).toHaveAttribute(
        "data-qr-mode",
        "online-link",
      ),
    );
  });

  it("prefers a token passed in over the stored one", async () => {
    await saveOfflinePasscard(token);
    const newer = await signOfflinePasscard(
      { ...payload, seatNumber: "C-8" },
      pair.privateKey,
    );
    render(
      <FlightClearancePasscard
        isOpen
        onClose={jest.fn()}
        bookingId={payload.bookingId}
        offlineToken={newer}
      />,
    );
    expect(qr().getAttribute("data-value")).toBe(newer);
  });
});
