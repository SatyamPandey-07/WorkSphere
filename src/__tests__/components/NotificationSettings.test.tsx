import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotificationSettings } from "@/app/dashboard/NotificationSettings";

// Mock next/image (avatar preview)
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt={props.alt} />;
  },
}));

// Mock react-easy-crop so the cropper modal doesn't need real canvas/image behavior
jest.mock("react-easy-crop", () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="mock-cropper">
      <button
        type="button"
        onClick={() =>
          props.onCropComplete?.(
            { x: 0, y: 0, width: 10, height: 10 },
            { x: 0, y: 0, width: 10, height: 10 },
          )
        }
      >
        mock-crop-complete
      </button>
    </div>
  ),
}));

const mockSettingsResponse = {
  phoneNumber: "",
  smsAlertsEnabled: false,
  whatsappWebhookUrl: "",
  notificationStart: "",
  notificationEnd: "",
  timezone: "UTC",
  imageUrl: "",
};

describe("NotificationSettings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockImplementation(
      (url: string, options?: any) => {
        if (
          url === "/api/user/settings" &&
          (!options || options.method === undefined)
        ) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockSettingsResponse),
          });
        }
        if (url === "/api/user/settings" && options?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      },
    );
  });

  it("shows a loading indicator before settings have loaded", () => {
    // Make fetch hang so we can observe the loading state
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const { container } = render(<NotificationSettings />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("renders the form once settings have loaded", async () => {
    render(<NotificationSettings />);

    await waitFor(() => {
      expect(screen.getByText("Notification Settings")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Phone Number")).toBeInTheDocument();
    expect(screen.getByLabelText(/WhatsApp Webhook URL/i)).toBeInTheDocument();
  });

  it("associates the Phone Number label with its input via htmlFor/id", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText("Phone Number"));

    const input = screen.getByLabelText("Phone Number");
    expect(input).toHaveAttribute("id", "phone-number");
  });

  it("associates the WhatsApp Webhook URL label with its input via htmlFor/id", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/WhatsApp Webhook URL/i));

    const input = screen.getByLabelText(/WhatsApp Webhook URL/i);
    expect(input).toHaveAttribute("id", "whatsapp-webhook-url");
  });

  it("updates the phone number input value on change", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText("Phone Number"));

    const input = screen.getByLabelText("Phone Number") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "+15551234567" } });

    expect(input.value).toBe("+15551234567");
  });

  it("updates the WhatsApp webhook URL input value on change", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/WhatsApp Webhook URL/i));

    const input = screen.getByLabelText(
      /WhatsApp Webhook URL/i,
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "https://hooks.zapier.com/abc123" },
    });

    expect(input.value).toBe("https://hooks.zapier.com/abc123");
  });

  it("toggles the SMS alerts checkbox", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/Opt-in to SMS reminders/i));

    const checkbox = screen.getByLabelText(
      /Opt-in to SMS reminders/i,
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("submits updated settings via POST /api/user/settings", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText("Phone Number"));

    fireEvent.change(screen.getByLabelText("Phone Number"), {
      target: { value: "+15551234567" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Save Settings/i }));

    await waitFor(() => {
      expect(
        screen.getByText("Settings saved successfully!"),
      ).toBeInTheDocument();
    });

    const postCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, options]) =>
        url === "/api/user/settings" && options?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall![1].body);
    expect(body.phoneNumber).toBe("+15551234567");
  }, 20000);

  it("shows an error message when saving fails", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText("Phone Number"));

    (global.fetch as jest.Mock).mockImplementation(
      (url: string, options?: any) => {
        if (url === "/api/user/settings" && options?.method === "POST") {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({}),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockSettingsResponse),
        });
      },
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Settings/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save settings.")).toBeInTheDocument();
    });
  });

  it("sets the cropped area via the crop modal after selecting a file", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("Change Avatar"));

    // Simulate selecting a file, which opens the crop modal
    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;

    const file = new File(["dummy"], "avatar.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      // allow FileReader onload to resolve
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByText("Crop Avatar")).toBeInTheDocument();
    });

    // Trigger the mocked cropper's onCropComplete
    fireEvent.click(screen.getByText("mock-crop-complete"));

    expect(screen.getByText("Save Avatar")).toBeInTheDocument();
  });
});
