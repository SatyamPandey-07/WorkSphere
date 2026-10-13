import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotificationBell } from "@/components/NotificationBell";
import { ToastProvider } from "@/components/ui/Toast";

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

    global.fetch = jest
      .fn()
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

    const bellBtn = screen.getByRole("button", {
      name: "Open notifications menu",
    });
    fireEvent.click(bellBtn);

    // Opening should trigger markAsRead API call
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/notifications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "markAsRead" }),
        }),
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

    global.fetch = jest
      .fn()
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

    const bellBtn = screen.getByRole("button", {
      name: "Open notifications menu",
    });
    fireEvent.click(bellBtn);

    const clearAllBtn = screen.getByRole("button", {
      name: "Clear all notifications",
    });
    expect(clearAllBtn).toBeInTheDocument();
    expect(screen.getByText("Clear All")).toBeInTheDocument();

    fireEvent.click(clearAllBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/notifications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "clearAll" }),
        }),
      );
    });

    expect(screen.getByText("All caught up! 🎉")).toBeInTheDocument();
  });

  it("renders unread counter beside header title and decrements badge count as items are dismissed", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        title: "Seat Available",
        body: "Desk #14 is now open.",
        read: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "notif-2",
        title: "Booking Reminder",
        body: "Your booking starts in 1 hour.",
        read: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "notif-3",
        title: "Wifi Verified",
        body: "Venue WiFi has been verified.",
        read: false,
        createdAt: new Date().toISOString(),
      },
    ];

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unreadCount: 3,
        }),
      } as any)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

    render(<NotificationBell />);

    // Outer bell badge
    const badge3 = await screen.findByText("3");
    expect(badge3).toBeInTheDocument();

    const bellBtn = screen.getByRole("button", {
      name: "Open notifications menu",
    });
    fireEvent.click(bellBtn);

    // Dismiss first notification
    const dismissBtns = screen.getAllByTitle("Dismiss");
    expect(dismissBtns.length).toBe(3);

    fireEvent.click(dismissBtns[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/notifications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "dismiss", id: "notif-1" }),
        }),
      );
    });

    // Dismiss remaining notifications
    const remainingDismissBtns = screen.getAllByTitle("Dismiss");
    expect(remainingDismissBtns.length).toBe(2);

    fireEvent.click(remainingDismissBtns[0]);
    fireEvent.click(remainingDismissBtns[1]);

    await waitFor(() => {
      expect(screen.getByText("All caught up! 🎉")).toBeInTheDocument();
    });
  });

  it("triggers confirmation toast and restores unread state when Undo is clicked within 5 seconds", async () => {
    const mockNotifications = [
      {
        id: "notif-1",
        title: "Desk Confirmed",
        body: "Desk #4 is ready.",
        read: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "notif-2",
        title: "WiFi Access",
        body: "Network password updated.",
        read: false,
        createdAt: new Date().toISOString(),
      },
    ];

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unreadCount: 2,
        }),
      } as any)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

    render(
      <ToastProvider>
        <NotificationBell />
      </ToastProvider>,
    );

    // Initial badge
    const badge = await screen.findByText("2");
    expect(badge).toBeInTheDocument();

    const bellBtn = screen.getByRole("button", {
      name: "Open notifications menu",
    });
    fireEvent.click(bellBtn);

    // Click "Mark all as read"
    const markAllBtn = await screen.findByRole("button", {
      name: "Mark all as read",
    });
    expect(markAllBtn).toBeInTheDocument();
    fireEvent.click(markAllBtn);

    // Verify transient success toast is displayed
    const toastMsg = await screen.findByText(
      "All notifications marked as read",
    );
    expect(toastMsg).toBeInTheDocument();

    // Verify accessible Undo button with keyboard support
    const undoBtn = screen.getByRole("button", { name: "Undo" });
    expect(undoBtn).toBeInTheDocument();
    expect(undoBtn).toHaveAttribute("type", "button");
    React.act(() => {
      undoBtn.focus();
    });
    expect(undoBtn).toHaveFocus();

    // Click undo
    fireEvent.click(undoBtn);

    // Verify unread state is restored
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/user/notifications",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "markAsUnread",
            ids: ["notif-1", "notif-2"],
          }),
        }),
      );
    });

    const restoredBadges = await screen.findAllByText("2");
    expect(restoredBadges.length).toBeGreaterThan(0);
    expect(screen.getByTestId("unread-badge-counter")).toHaveTextContent("2");
  });

  it("expires undo callback after 5-second window", async () => {
    jest.useFakeTimers();

    const mockNotifications = [
      {
        id: "notif-1",
        title: "Desk Confirmed",
        body: "Desk #4 is ready.",
        read: false,
        createdAt: new Date().toISOString(),
      },
    ];

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: mockNotifications,
          unreadCount: 1,
        }),
      } as any)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

    render(
      <ToastProvider>
        <NotificationBell />
      </ToastProvider>,
    );

    // Resolve fetch promise
    await React.act(async () => {
      jest.advanceTimersByTime(10);
    });

    const bellBtn = screen.getByRole("button", {
      name: "Open notifications menu",
    });
    await React.act(async () => {
      fireEvent.click(bellBtn);
    });

    const markAllBtn = screen.getByRole("button", { name: "Mark all as read" });
    await React.act(async () => {
      fireEvent.click(markAllBtn);
    });

    expect(
      screen.getByText("All notifications marked as read"),
    ).toBeInTheDocument();

    // Advance timers past 5 seconds (5000ms)
    await React.act(async () => {
      jest.advanceTimersByTime(5100);
    });

    // Toast auto-dismisses after 5 seconds countdown
    expect(
      screen.queryByText("All notifications marked as read"),
    ).not.toBeInTheDocument();

    jest.useRealTimers();
  });
});
