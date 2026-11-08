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

jest.mock("@/components/sessions/Scratchpad", () => {
  return function MockScratchpad() {
    return <div data-testid="mock-scratchpad" />;
  };
});

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { id: "user_waitlisted_2", firstName: "Morgan", lastName: "Lee" },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("mock-token"),
  }),
}));

const mockSessionWithWaitlist = {
  slug: "ai-builders-jam",
  title: "AI Builders Coworking Jam",
  description: "Hack and build AI agents together.",
  startsAt: "2026-10-25T14:00:00.000Z",
  endsAt: "2026-10-25T18:00:00.000Z",
  maxGuests: 2,
  host: {
    id: "user_host_1",
    firstName: "Elena",
    lastName: "Rostova",
  },
  venue: {
    name: "Hacker Dojo Cafe",
    address: "789 Innovation Way",
    latitude: 37.7749,
    longitude: -122.4194,
    category: "cafe",
  },
  rsvps: [
    {
      status: "GOING" as const,
      user: {
        id: "user_host_1",
        firstName: "Elena",
        lastName: "Rostova",
        imageUrl: null,
      },
    },
    {
      status: "GOING" as const,
      user: {
        id: "user_attendee_1",
        firstName: "Jordan",
        lastName: "Smith",
        imageUrl: null,
      },
    },
    {
      status: "MAYBE" as const,
      user: {
        id: "user_waitlisted_1",
        firstName: "Taylor",
        lastName: "Swift",
        imageUrl: null,
      },
    },
    {
      status: "MAYBE" as const,
      user: {
        id: "user_waitlisted_2",
        firstName: "Morgan",
        lastName: "Lee",
        imageUrl: null,
      },
    },
    {
      status: "MAYBE" as const,
      user: {
        id: "user_waitlisted_3",
        firstName: "Casey",
        lastName: "Neistat",
        imageUrl: null,
      },
    },
  ],
};

describe("SessionDetailClient Real-Time Waitlist Position Counter (#5035)", () => {
  it("renders the waitlist position badge, waitlist status card, and highlights the user entry in the sidebar", () => {
    render(<SessionDetailClient session={mockSessionWithWaitlist} />);

    // Header waitlist position badge
    const badge = screen.getByTestId("waitlist-position-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Waitlist Position: #2 of 3");

    // Main section waitlist status card
    const card = screen.getByTestId("waitlist-status-card");
    expect(card).toBeInTheDocument();
    expect(screen.getByText(/You are on the Waitlist/i)).toBeInTheDocument();

    const counter = screen.getByTestId("waitlist-position-counter");
    expect(counter).toHaveTextContent("#2 of 3");

    // Sidebar waitlist queue item highlight
    const userEntry = screen.getByTestId("user-waitlist-entry");
    expect(userEntry).toBeInTheDocument();
    expect(userEntry).toHaveTextContent("Morgan Lee (You)");
    expect(userEntry).toHaveTextContent("#2");
  });
});
