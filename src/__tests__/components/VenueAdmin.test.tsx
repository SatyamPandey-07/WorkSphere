import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import VenueAdminPage from "../../app/venue-admin/page";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";

jest.mock("@clerk/nextjs", () => ({
  useUser: jest.fn(),
  SignInButton: ({ children }: any) => children,
}));

jest.mock("next/navigation", () => ({
  useSearchParams: jest.fn(),
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

describe("VenueAdmin Dashboard & Weekly Scheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSearchParams as jest.Mock).mockReturnValue({
      get: jest.fn().mockImplementation((key) => {
        if (key === "claimId") return "test-claim-id";
        return null;
      }),
    });
  });

  it("renders sign in state when user is not signed in", () => {
    (useUser as jest.Mock).mockReturnValue({
      isLoaded: true,
      isSignedIn: false,
      user: null,
    });

    render(<VenueAdminPage />);

    expect(screen.getByText("Access Restricted")).toBeInTheDocument();
    expect(screen.getByText("Sign In to Owner Portal")).toBeInTheDocument();
  });

  it("renders claiming layout when signed in and claimId is present", async () => {
    (useUser as jest.Mock).mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      user: { id: "user_1" },
    });

    // Mock search API fetch call
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes("/api/venues/search")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "test-claim-id",
              name: "Claimable Cafe",
              address: "456 Street",
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      });
    });

    await act(async () => {
      render(<VenueAdminPage />);
    });

    expect(screen.getByText("Claim listing ownership")).toBeInTheDocument();
    expect(screen.getByText("Confirm Ownership")).toBeInTheDocument();
  });
});
