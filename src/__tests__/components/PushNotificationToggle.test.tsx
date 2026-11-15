import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PushNotificationToggle } from "@/components/PushNotificationToggle";
import { usePushNotifications } from "@/hooks/usePushNotifications";

jest.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: jest.fn(),
}));

describe("PushNotificationToggle Component (#6909)", () => {
  const mockSubscribe = jest.fn();
  const mockUnsubscribe = jest.fn();
  const mockOnSuccess = jest.fn();
  const mockOnError = jest.fn();

  const defaultHookReturn = {
    isSupported: true,
    isSubscribed: false,
    permission: "default" as NotificationPermission,
    isLoading: false,
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (usePushNotifications as jest.Mock).mockReturnValue({ ...defaultHookReturn });
  });

  it("returns null when push notifications are not supported", () => {
    (usePushNotifications as jest.Mock).mockReturnValue({
      ...defaultHookReturn,
      isSupported: false,
    });

    const { container } = render(<PushNotificationToggle />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("push-notification-toggle")).not.toBeInTheDocument();
  });

  it("returns null when notification permission is denied", () => {
    (usePushNotifications as jest.Mock).mockReturnValue({
      ...defaultHookReturn,
      permission: "denied",
    });

    const { container } = render(<PushNotificationToggle />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("push-notification-toggle")).not.toBeInTheDocument();
  });

  it("renders unsubscribed state with BellOff icon and title", () => {
    render(<PushNotificationToggle />);

    const button = screen.getByTestId("push-notification-toggle");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Enable notifications");

    expect(screen.getByTestId("push-notification-bell-off-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("push-notification-bell-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("push-notification-label")).toHaveTextContent("Notifications off");
  });

  it("renders subscribed state with Bell icon and title", () => {
    (usePushNotifications as jest.Mock).mockReturnValue({
      ...defaultHookReturn,
      isSubscribed: true,
      permission: "granted",
    });

    render(<PushNotificationToggle />);

    const button = screen.getByTestId("push-notification-toggle");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Disable notifications");

    expect(screen.getByTestId("push-notification-bell-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("push-notification-bell-off-icon")).not.toBeInTheDocument();
    expect(screen.getByTestId("push-notification-label")).toHaveTextContent("Notifications on");
  });

  it("calls subscribe and onSuccess(true) when toggled from unsubscribed state", async () => {
    mockSubscribe.mockResolvedValueOnce(undefined);

    render(<PushNotificationToggle onSuccess={mockOnSuccess} onError={mockOnError} />);

    const button = screen.getByTestId("push-notification-toggle");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockOnSuccess).toHaveBeenCalledWith(true);
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it("calls unsubscribe and onSuccess(false) when toggled from subscribed state", async () => {
    (usePushNotifications as jest.Mock).mockReturnValue({
      ...defaultHookReturn,
      isSubscribed: true,
      permission: "granted",
    });
    mockUnsubscribe.mockResolvedValueOnce(undefined);

    render(<PushNotificationToggle onSuccess={mockOnSuccess} onError={mockOnError} />);

    const button = screen.getByTestId("push-notification-toggle");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockOnSuccess).toHaveBeenCalledWith(false);
    expect(mockOnError).not.toHaveBeenCalled();
  });

  it("handles error in subscribe gracefully and calls onError", async () => {
    const error = new Error("Push registration failed");
    mockSubscribe.mockRejectedValueOnce(error);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    render(<PushNotificationToggle onSuccess={mockOnSuccess} onError={mockOnError} />);

    const button = screen.getByTestId("push-notification-toggle");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockOnSuccess).not.toHaveBeenCalled();
    expect(mockOnError).toHaveBeenCalledWith(error);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("handles error in unsubscribe gracefully and calls onError", async () => {
    (usePushNotifications as jest.Mock).mockReturnValue({
      ...defaultHookReturn,
      isSubscribed: true,
      permission: "granted",
    });
    const error = new Error("Unsubscribe server timeout");
    mockUnsubscribe.mockRejectedValueOnce(error);
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    render(<PushNotificationToggle onSuccess={mockOnSuccess} onError={mockOnError} />);

    const button = screen.getByTestId("push-notification-toggle");
    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(mockOnSuccess).not.toHaveBeenCalled();
    expect(mockOnError).toHaveBeenCalledWith(error);

    consoleErrorSpy.mockRestore();
  });

  it("renders disabled state with loading icon when hook isLoading is true", () => {
    (usePushNotifications as jest.Mock).mockReturnValue({
      ...defaultHookReturn,
      isLoading: true,
    });

    render(<PushNotificationToggle />);

    const button = screen.getByTestId("push-notification-toggle");
    expect(button).toBeDisabled();
    expect(screen.getByTestId("push-notification-loading-icon")).toBeInTheDocument();
    expect(screen.getByTestId("push-notification-label")).toHaveTextContent("Updating...");
  });

  it("renders icon only when showLabel is false", () => {
    render(<PushNotificationToggle showLabel={false} />);

    expect(screen.getByTestId("push-notification-bell-off-icon")).toBeInTheDocument();
    expect(screen.queryByTestId("push-notification-label")).not.toBeInTheDocument();
  });

  it("applies custom className prop to button element", () => {
    render(<PushNotificationToggle className="my-custom-toggle-class" />);

    const button = screen.getByTestId("push-notification-toggle");
    expect(button).toHaveClass("my-custom-toggle-class");
  });

  it("prevents multiple concurrent toggles when already toggling", async () => {
    let resolveSubscribe: () => void = () => {};
    const pendingPromise = new Promise<void>((resolve) => {
      resolveSubscribe = resolve;
    });
    mockSubscribe.mockReturnValueOnce(pendingPromise);

    render(<PushNotificationToggle />);

    const button = screen.getByTestId("push-notification-toggle");

    // First click initiates toggle
    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toBeDisabled();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Second click while busy should be ignored
    await act(async () => {
      fireEvent.click(button);
    });
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Resolve initial subscribe
    await act(async () => {
      resolveSubscribe();
    });

    // No longer busy
    expect(button).not.toBeDisabled();
  });
});
