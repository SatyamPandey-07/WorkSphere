import React from "react";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DeskFavoriteAlertButton } from "@/components/venue/DeskFavoriteAlertButton";

global.fetch = jest.fn() as jest.Mock;

describe("DeskFavoriteAlertButton component", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders with star button in compact variant", () => {
    render(
      <DeskFavoriteAlertButton
        venueId="v-1"
        deskId="desk-1"
        deskLabel="Window Desk 1"
        variant="compact"
      />,
    );

    const button = screen.getByTitle("Star as favorite desk");
    expect(button).toBeDefined();
  });

  it("displays toast with responsive right-0 sm:left-1/2 positioning classes", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        isFavorited: true,
        message: "Added to favorites",
      }),
    });

    render(
      <DeskFavoriteAlertButton
        venueId="v-1"
        deskId="desk-1"
        deskLabel="Window Desk 1"
        variant="compact"
      />,
    );

    const button = screen.getByTitle("Star as favorite desk");
    await act(async () => {
      fireEvent.click(button);
    });

    const toast = screen.getByTestId("desk-favorite-toast");
    expect(toast).toBeDefined();
    expect(toast.textContent).toBe("Added to favorites");

    // Verify responsive positioning preventing horizontal overflow on mobile
    expect(toast.className).toContain("right-0");
    expect(toast.className).toContain("sm:left-1/2");
    expect(toast.className).toContain("translate-x-0");
    expect(toast.className).toContain("sm:-translate-x-1/2");
  });
});
