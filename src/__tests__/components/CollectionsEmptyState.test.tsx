import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CollectionsPage from "@/app/collections/page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

describe("CollectionsPage empty state", () => {
  beforeAll(() => {
    // jsdom does not implement scrollIntoView, which the CTA uses.
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ folders: [] }),
    });
  });

  it("shows the empty state when the user has no collections", async () => {
    render(<CollectionsPage />);

    expect(await screen.findByText("No Collections Yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Create a collection to start saving your favorite venues.",
      ),
    ).toBeInTheDocument();
  });

  it("moves focus to the creation form when the CTA is clicked", async () => {
    render(<CollectionsPage />);

    const cta = await screen.findByRole("button", {
      name: /create collection/i,
    });
    fireEvent.click(cta);

    expect(screen.getByPlaceholderText("Collection Name")).toHaveFocus();
  });
});
