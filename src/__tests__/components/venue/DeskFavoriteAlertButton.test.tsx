import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultDeskFavoriteAlertButton, {
  DeskFavoriteAlertButton,
} from "@/components/venue/DeskFavoriteAlertButton";

describe("DeskFavoriteAlertButton Component", () => {
  const defaultProps = {
    venueId: "venue-123",
    venueName: "Creative Hub",
    deskId: "desk-456",
    deskLabel: "Desk A-12",
    deskType: "standing" as const,
    price: 25,
    tags: ["quiet", "window"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Exports", () => {
    it("exports DeskFavoriteAlertButton as both named and default export", () => {
      expect(DefaultDeskFavoriteAlertButton).toBe(DeskFavoriteAlertButton);
    });
  });

  describe("Compact Variant", () => {
    it("renders favorite button and suppresses alert button when not occupied", () => {
      render(<DeskFavoriteAlertButton {...defaultProps} isOccupied={false} />);

      const favBtn = screen.getByTestId("toggle-favorite-btn");
      expect(favBtn).toBeInTheDocument();
      expect(favBtn).toHaveAttribute("title", "Star as favorite desk");
      expect(screen.queryByTestId("toggle-alert-btn")).not.toBeInTheDocument();
    });

    it("renders alert button when desk is occupied", () => {
      render(<DeskFavoriteAlertButton {...defaultProps} isOccupied={true} />);

      const alertBtn = screen.getByTestId("toggle-alert-btn");
      expect(alertBtn).toBeInTheDocument();
      expect(alertBtn).toHaveAttribute("title", "Notify me when this desk is free");
    });

    it("handles favorite toggle successfully and displays toast", async () => {
      const onUpdateMock = jest.fn();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFavorited: true,
          message: "Saved to your favorite desks!",
        }),
      });

      render(
        <DeskFavoriteAlertButton
          {...defaultProps}
          onUpdate={onUpdateMock}
        />
      );

      const favBtn = screen.getByTestId("toggle-favorite-btn");
      fireEvent.click(favBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/venues/venue-123/desks/favorites",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              venueId: "venue-123",
              venueName: "Creative Hub",
              deskId: "desk-456",
              deskLabel: "Desk A-12",
              deskType: "standing",
              price: 25,
              tags: ["quiet", "window"],
            }),
          })
        );
      });

      expect(await screen.findByTestId("desk-favorite-toast")).toHaveTextContent(
        "Saved to your favorite desks!"
      );
      expect(favBtn).toHaveAttribute("title", "Remove from favorite desks");
      expect(onUpdateMock).toHaveBeenCalled();
    });

    it("handles vacancy alert toggle successfully", async () => {
      const onUpdateMock = jest.fn();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: true,
          message: "Vacancy alert activated!",
        }),
      });

      render(
        <DeskFavoriteAlertButton
          {...defaultProps}
          isOccupied={true}
          onUpdate={onUpdateMock}
        />
      );

      const alertBtn = screen.getByTestId("toggle-alert-btn");
      fireEvent.click(alertBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/venues/venue-123/desks/favorites",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "alert",
              venueId: "venue-123",
              venueName: "Creative Hub",
              deskId: "desk-456",
              deskLabel: "Desk A-12",
              deskType: "standing",
              price: 25,
              tags: ["quiet", "window"],
              active: true,
              alertMethods: ["in_app", "push"],
            }),
          })
        );
      });

      expect(await screen.findByTestId("desk-favorite-toast")).toHaveTextContent(
        "Vacancy alert activated!"
      );
      expect(alertBtn).toHaveAttribute("title", "Vacancy alert active");
      expect(onUpdateMock).toHaveBeenCalled();
    });
  });

  describe("Full Variant", () => {
    it("renders full labels and toggles states", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFavorited: true,
          message: "Added to favorites",
        }),
      });

      render(
        <DeskFavoriteAlertButton
          {...defaultProps}
          variant="full"
          isOccupied={true}
        />
      );

      expect(screen.getByText("Favorite Desk")).toBeInTheDocument();
      expect(screen.getByText("Notify When Free")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("toggle-favorite-btn"));

      await waitFor(() => {
        expect(screen.getByText("Favorited")).toBeInTheDocument();
      });
      expect(screen.getByText("✓ Added to favorites")).toBeInTheDocument();
    });

    it("handles alert activation in full variant", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          active: true,
          message: "Notification set",
        }),
      });

      render(
        <DeskFavoriteAlertButton
          {...defaultProps}
          variant="full"
          isOccupied={true}
        />
      );

      fireEvent.click(screen.getByTestId("toggle-alert-btn"));

      await waitFor(() => {
        expect(screen.getByText("Alert Active")).toBeInTheDocument();
      });
      expect(screen.getByText("✓ Notification set")).toBeInTheDocument();
    });
  });

  describe("Error Handling & Lifecycle", () => {
    it("catches fetch error gracefully without throwing", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network failed"));

      render(<DeskFavoriteAlertButton {...defaultProps} isOccupied={true} />);

      fireEvent.click(screen.getByTestId("toggle-favorite-btn"));

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to toggle desk favorite:",
          expect.any(Error)
        );
      });

      expect(screen.queryByTestId("desk-favorite-toast")).not.toBeInTheDocument();
      consoleSpy.mockRestore();
    });

    it("catches alert toggle error gracefully without throwing", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network failed"));

      render(<DeskFavoriteAlertButton {...defaultProps} isOccupied={true} />);

      fireEvent.click(screen.getByTestId("toggle-alert-btn"));

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to toggle vacancy alert:",
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    it("clears toast timer on unmount without warning", async () => {
      jest.useFakeTimers();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          isFavorited: true,
          message: "Timer check",
        }),
      });

      const { unmount } = render(<DeskFavoriteAlertButton {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId("toggle-favorite-btn"));
      });

      unmount();
      act(() => {
        jest.runAllTimers();
      });
      jest.useRealTimers();
    });
  });

  describe("Custom Props & Test IDs", () => {
    it("applies custom className and data-testid", () => {
      render(
        <DeskFavoriteAlertButton
          {...defaultProps}
          className="custom-desk-alert-btn"
          data-testid="custom-desk-favorite-id"
        />
      );

      const el = screen.getByTestId("custom-desk-favorite-id");
      expect(el).toBeInTheDocument();
      expect(el).toHaveClass("custom-desk-alert-btn");
    });
  });
});
