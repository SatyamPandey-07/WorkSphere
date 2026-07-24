import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StudentVerificationBadge } from "@/components/student/StudentVerificationBadge";

beforeEach(() => {
  jest.clearAllMocks();
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
  expect(screen.getByText("Verified Student").closest("div")).toHaveClass("bg-green-500/10");
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
