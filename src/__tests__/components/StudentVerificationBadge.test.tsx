import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StudentVerificationBadge } from "@/components/student/StudentVerificationBadge";

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

it("renders nothing while loading", () => {
  global.fetch = jest.fn(() => new Promise(() => {}));
  const { container } = render(<StudentVerificationBadge />);
  expect(container.innerHTML).toBe("");
});

it("shows verified badge when API returns verified=true", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ verified: true }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Verified Student")).toBeInTheDocument();
  });
  expect(screen.getByText("Verified Student").closest("div")).toHaveClass(
    "bg-green-500/10",
  );
});

it("shows unverified badge when API returns verified=false", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ verified: false }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Student Not Verified")).toBeInTheDocument();
  });
});

it("re-fetches when refreshKey changes", async () => {
  const mockFetch = jest.fn().mockResolvedValue({
    json: async () => ({ verified: false }),
  });
  global.fetch = mockFetch;

  const { rerender } = render(<StudentVerificationBadge refreshKey={0} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

  rerender(<StudentVerificationBadge refreshKey={1} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
});

it("shows unverified badge on fetch error", async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error("network"));

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Student Not Verified")).toBeInTheDocument();
  });
});

it("shows tooltip on hover when verification info is present", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({
      verified: true,
      expiresAt: "2027-01-01T00:00:00.000Z",
      commitmentHash: "0x84fae75891cd",
    }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Verified Student")).toBeInTheDocument();
  });

  const badge = screen.getByText("Verified Student").closest("div");
  fireEvent.mouseEnter(badge!);

  await waitFor(() => {
    expect(screen.getByText(/Expires:/)).toBeInTheDocument();
  });
});

it("shows expiration date and shortened hash in tooltip", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({
      verified: true,
      expiresAt: "2027-01-01T00:00:00.000Z",
      commitmentHash: "0x84fae75891cd22223333444455556666",
    }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Verified Student")).toBeInTheDocument();
  });

  const badgeDiv = screen.getByText("Verified Student").closest("div")!;
  fireEvent.mouseEnter(badgeDiv);

  await waitFor(() => {
    expect(screen.getByText("Expires: Jan 1, 2027")).toBeInTheDocument();
  });
  expect(screen.getByText("Proof: 0x84fa...6666")).toBeInTheDocument();
});

it("shows 'Renew Soon' badge when expiration is within 14 days", async () => {
  // Current time is set to 2026-07-24T12:00:00.000Z via fake timers
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({
      verified: true,
      expiresAt: "2026-08-01T00:00:00.000Z", // 8 days away
    }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Renew Soon")).toBeInTheDocument();
  });
});

it("shows expired styling when verification has expired", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({
      verified: true,
      expiresAt: "2026-07-01T00:00:00.000Z", // Past date
    }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Student Not Verified")).toBeInTheDocument();
  });
});

it("handles missing expiration gracefully", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({
      verified: true,
      commitmentHash: "0x1234567890abcdef",
    }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Verified Student")).toBeInTheDocument();
  });

  const badgeDiv2 = screen.getByText("Verified Student").closest("div")!;
  fireEvent.mouseEnter(badgeDiv2);

  await waitFor(() => {
    expect(screen.getByText("Proof: 0x1234...cdef")).toBeInTheDocument();
  });
  expect(screen.queryByText(/Expires:/)).not.toBeInTheDocument();
});

it("handles missing commitment hash gracefully", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({
      verified: true,
      expiresAt: "2027-01-01T00:00:00.000Z",
    }),
  });

  render(<StudentVerificationBadge />);

  await waitFor(() => {
    expect(screen.getByText("Verified Student")).toBeInTheDocument();
  });

  const badgeDiv3 = screen.getByText("Verified Student").closest("div")!;
  fireEvent.mouseEnter(badgeDiv3);

  await waitFor(() => {
    expect(screen.getByText("Expires: Jan 1, 2027")).toBeInTheDocument();
  });
  expect(screen.queryByText(/Proof:/)).not.toBeInTheDocument();
});
