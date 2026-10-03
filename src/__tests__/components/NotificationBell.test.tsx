import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotificationBell } from "@/components/NotificationBell";

// Mock matchMedia
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

describe("NotificationBell Component (#685, #3429)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders closed bell button with no unread badge initially", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ notifications: [], unreadCount: 0 }),
    } as any);

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByTitle("Notifications")).toBeInTheDocument();
    });

    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders unread badge count when unreadCount > 0", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        title: "Seat Available",
        body: "A seat at Coffee House has opened up.",
        read: false,
        createdAt: new Date().toISOString(),
        venueId: "venue-1",
      },
    ];

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        notifications: mockNotifications,
        unreadCount: 1,
      }),
    } as any);

    render(<NotificationBell />);

    const badges = await screen.findAllByText("1");
    expect(badges.length).toBeGreaterThan(0);
  });

  it("marks all notifications as read when panel is opened", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        title: "Seat Available",
        body: "A seat at Coffee House has opened up.",
        read: false,
        createdAt: new Date().toISOString(),
        venueId: "venue-1",
      },
    ];

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unreadCount: 1,
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

    render(<NotificationBell />);

    const badge = await screen.findByText("1");
    expect(badge).toBeInTheDocument();

    const bellBtn = screen.getByRole("button", { name: "Open notifications menu" });
    fireEvent.click(bellBtn);

    // Opening should trigger markAsRead API call
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/notifications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "markAsRead" }),
        })
      );
    });

    // Count is set to 0 locally on click
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("triggers Clear All action and shows friendly empty state 'All caught up! 🎉'", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        title: "Booking Confirmed",
        body: "Your desk at Tech Hub is confirmed.",
        read: false,
        createdAt: new Date().toISOString(),
      },
    ];

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unreadCount: 1,
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

    render(<NotificationBell />);

    await screen.findByText("1");

    const bellBtn = screen.getByRole("button", { name: "Open notifications menu" });
    fireEvent.click(bellBtn);

    const clearAllBtn = screen.getByRole("button", { name: "Clear all notifications" });
    expect(clearAllBtn).toBeInTheDocument();
    expect(screen.getByText("Clear All")).toBeInTheDocument();

    fireEvent.click(clearAllBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/notifications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "clearAll" }),
        })
      );
    });

    expect(screen.getByText("All caught up! 🎉")).toBeInTheDocument();
  });
});
