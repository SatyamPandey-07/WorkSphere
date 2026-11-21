import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NomadPassportVerificationBadge } from "@/components/profile/NomadPassportVerificationBadge";

describe("NomadPassportVerificationBadge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a verified badge only for an authoritative verified response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, verified: true }),
    });

    render(<NomadPassportVerificationBadge />);

    const badge = await screen.findByTestId(
      "nomad-passport-verification-badge",
    );
    expect(badge).toHaveAttribute("aria-label", "Nomad Passport Verified");
    expect(screen.getByText("Nomad Passport Verified")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/auth/zkp/nomad-proof",
      { cache: "no-store" },
    );
  });

  it("does not render for unverified, pending, or rejected status responses", async () => {
    for (const responseBody of [
      { success: true, verified: false, status: "rejected" },
      { success: true, status: "pending" },
      { success: false, verified: true },
      { success: true, verified: "true" },
    ]) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => responseBody,
      });

      const { container } = render(<NomadPassportVerificationBadge />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(container).toBeEmptyDOMElement();
    }
  });

  it("does not render for missing profile data or API errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const { container, rerender } = render(
      <NomadPassportVerificationBadge />,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    global.fetch = jest.fn().mockRejectedValue(new Error("network"));
    rerender(<NomadPassportVerificationBadge refreshKey={1} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: true, verified: true }),
    });
    rerender(<NomadPassportVerificationBadge refreshKey={2} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while loading", () => {
    global.fetch = jest.fn(() => new Promise(() => {}));
    const { container } = render(<NomadPassportVerificationBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the exact tooltip text on focus", () => {
    render(<NomadPassportVerificationBadge verified={true} />);

    const badge = screen.getByTestId("nomad-passport-verification-badge");
    fireEvent.focus(badge);

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Nomad Passport Verified",
    );
  });

  it("does not render for a false explicit verified prop", () => {
    const { container } = render(
      <NomadPassportVerificationBadge verified={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("safely handles unmounting while the status request is pending", async () => {
    let resolveResponse: (response: {
      ok: boolean;
      json: () => Promise<{ success: boolean; verified: boolean }>;
    }) => void = () => {};
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const { unmount } = render(<NomadPassportVerificationBadge />);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    unmount();

    await resolveResponse({
      ok: true,
      json: async () => ({ success: true, verified: true }),
    });
  });
});
