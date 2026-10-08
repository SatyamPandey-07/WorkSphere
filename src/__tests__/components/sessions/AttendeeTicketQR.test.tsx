import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionDetailClient from "@/app/sessions/[slug]/session-detail-client";

jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock("@/components/sessions/ScreenSharePanel", () => {
  return function MockScreenSharePanel() {
    return <div data-testid="mock-screen-share" />;
  };
});
jest.mock("@/components/audio/MeshCallGrid", () => ({
  MeshCallGrid: function MockMeshCallGrid() {
    return <div data-testid="mock-mesh-grid" />;
  },
}));

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { id: "user_attendee_123", firstName: "Sam", lastName: "Attendee" },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("mock-token"),
  }),
}));

const mockSessionWithGoing = {
  slug: "design-sprint-social",
  title: "Design Sprint Coworking",
  description: "Collaborative design and prototyping session.",
  startsAt: "2026-10-20T10:00:00.000Z",
  endsAt: "2026-10-20T14:00:00.000Z",
  maxGuests: 8,
  host: {
    id: "user_host_999",
    firstName: "Elena",
    lastName: "Rostova",
  },
  venue: {
    name: "Artisan Roastery & Lab",
    address: "456 Market Blvd",
    latitude: 37.7749,
    longitude: -122.4194,
    category: "cafe",
  },
  rsvps: [
    {
      status: "GOING" as const,
      user: {
        id: "user_attendee_123",
        firstName: "Sam",
        lastName: "Attendee",
        imageUrl: null,
      },
    },
  ],
};

describe("SessionDetailClient Attendee Ticket Card & QR Code (#5066)", () => {
  it("renders the RSVP confirmation dialog containing the attendee ticket card with venue, date, and QR code", () => {
    render(<SessionDetailClient session={mockSessionWithGoing} />);

    // RSVP confirmation dialog
    const rsvpDialog = screen.getByTestId("rsvp-confirmation-dialog");
    expect(rsvpDialog).toBeInTheDocument();

    // Attendee ticket card
    const ticketCard = screen.getByTestId("attendee-ticket-card");
    expect(ticketCard).toBeInTheDocument();
    expect(screen.getByText(/Attendee Admission Ticket/i)).toBeInTheDocument();

    // Venue name displayed
    const venueEl = screen.getByTestId("ticket-venue");
    expect(venueEl).toHaveTextContent("Artisan Roastery & Lab");

    // Session date displayed
    const dateEl = screen.getByTestId("ticket-date");
    expect(dateEl).toHaveTextContent(/2026/);

    // QR code rendered
    const qrEl = screen.getByTestId("ticket-qr-code");
    expect(qrEl).toBeInTheDocument();
    expect(qrEl.querySelector("svg")).toBeInTheDocument();
  });
});
