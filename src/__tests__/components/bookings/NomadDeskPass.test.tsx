import React from "react";
import { act, render, screen } from "@testing-library/react";
import {
  buildDeskPassPngFilename,
  NomadDeskPass,
  sanitizeFilenameSegment,
} from "@/components/bookings/NomadDeskPass";

jest.mock("@/lib/security/offlinePasscardStore", () => ({
  getOfflinePasscardRecord: jest
    .fn()
    .mockResolvedValue({ token: "test-offline-token" }),
  saveOfflinePasscard: jest.fn(),
}));

const createBooking = (address?: string | null) => ({
  id: "booking-1",
  confirmationId: "WS-99",
  date: "2026-11-26",
  time: "10:00",
  venue: {
    name: "NomadDesk Jaipur",
    address,
  },
});

const renderPass = async (address?: string | null) => {
  await act(async () => {
    render(
      <NomadDeskPass
        booking={createBooking(address)}
        isOpen
        onClose={jest.fn()}
      />,
    );
  });
};

describe("NomadDeskPass address rendering", () => {
  it.each([null, undefined, "", "   "])(
    "omits the address row when the address is %p",
    async (address) => {
      await renderPass(address);

      expect(
        screen.queryByTestId("nomad-desk-pass-address"),
      ).not.toBeInTheDocument();
    },
  );

  it("renders a valid venue address", async () => {
    await renderPass("Jaipur, Rajasthan");

    expect(screen.getByTestId("nomad-desk-pass-address")).toHaveTextContent(
      "Jaipur, Rajasthan",
    );
  });
});

describe("NomadDeskPass PNG filename sanitization", () => {
  it("sanitizes invalid path characters and handles Unicode and empty inputs", () => {
    expect(sanitizeFilenameSegment("Bandra / West \\ Hub: A*B?C")).toBe(
      "Bandra-West-Hub-A-B-C",
    );
    expect(sanitizeFilenameSegment("Café Powai — Studio")).toBe(
      "Cafe-Powai-Studio",
    );
    expect(sanitizeFilenameSegment("   ", "fallback-venue")).toBe(
      "fallback-venue",
    );
    expect(sanitizeFilenameSegment("", "fallback-id")).toBe("fallback-id");

    expect(
      buildDeskPassPngFilename("Bandra/West: Studio *1?", "CONF\\2026:01/02"),
    ).toBe("nomad-desk-pass-Bandra-West-Studio-1-CONF-2026-01-02.png");
  });
});
