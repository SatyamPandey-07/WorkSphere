import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionDetailClient from "@/app/sessions/[slug]/session-detail-client";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams("");

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: { id: "user_host_123", firstName: "Alex", lastName: "Host" },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue("mock-token"),
  }),
}));

const mockSession = {
  slug: "test-coworking-session",
  title: "Friday Deep Work Session",
  description: "Join us for quiet focus and coffee.",
  startsAt: new Date(Date.now() + 3600000).toISOString(),
  endsAt: new Date(Date.now() + 7200000).toISOString(),
  maxGuests: 10,
  host: {
    id: "user_host_123",
    firstName: "Alex",
    lastName: "Host",
  },
  venue: {
    name: "Downtown Cafe",
    address: "123 Main St",
    latitude: 37.7749,
    longitude: -122.4194,
    category: "cafe",
  },
  rsvps: [
    {
      status: "GOING" as const,
      user: {
        id: "user_host_123",
        firstName: "Alex",
        lastName: "Host",
        imageUrl: null,
      },
    },
  ],
};

describe("SessionDetailClient Secure Invite Generator (#1420)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams("");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it("renders Copy Invite Link button and copies secure invite link on click", async () => {
    render(<SessionDetailClient session={mockSession} />);

    const copyBtn = screen.getByRole("button", { name: /Copy Invite Link/i });
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          "/sessions/test-coworking-session?inviteToken=",
        ),
      );
      expect(
        screen.getByText(/Secure invite link copied to clipboard/i),
      ).toBeInTheDocument();
    });
  });
});
