import "@testing-library/jest-dom";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { NotificationSettings } from "@/app/dashboard/NotificationSettings";

// Mock react-easy-crop to avoid rendering canvas issues
jest.mock("react-easy-crop", () => {
  return function MockCropper() {
    return <div data-testid="mock-cropper">Mock Cropper</div>;
  };
});

describe("NotificationSettings", () => {
  beforeEach(() => {
    // Mock global fetch
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            phoneNumber: "+1234567890",
            smsAlertsEnabled: true,
            whatsappWebhookUrl: "https://example.com/whatsapp",
            telegramWebhookUrl: "https://example.com/telegram",
            notificationStart: "09:00",
            notificationEnd: "17:00",
            imageUrl: "https://example.com/avatar.jpg",
            timezone: "America/New_York",
          }),
      }),
    ) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders loading state initially and then loads settings", async () => {
    render(<NotificationSettings />);

    // Wait for the mock fetch to resolve and render the fields
    await waitFor(() => {
      expect(screen.getByText("Notification Settings")).toBeInTheDocument();
    });

    expect(screen.getByText("Profile Avatar")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
    expect(screen.getByLabelText("WhatsApp Webhook URL")).toBeInTheDocument();
  });
});
