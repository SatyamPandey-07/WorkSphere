import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PasskeyManager } from "@/components/auth/PasskeyManager";

// Mock @simplewebauthn/browser
jest.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: jest.fn(() => true),
  startRegistration: jest.fn(),
}));

// Mock hooks and child components
jest.mock("@/hooks/useCsrfToken", () => ({
  useCsrfToken: () => ({ csrfToken: "mock-csrf-token" }),
}));

jest.mock("@/components/auth/PasskeyOtpDialog", () => ({
  PasskeyOtpDialog: () => <div data-testid="otp-dialog" />,
}));

jest.mock("@/components/auth/StepUpReAuthModal", () => ({
  StepUpReAuthModal: () => <div data-testid="step-up-modal" />,
}));

jest.mock("@/components/auth/PasskeySecurityAuditLog", () => ({
  PasskeySecurityAuditLog: () => <div data-testid="audit-log" />,
}));

jest.mock("@/lib/auth/passkeys/deviceDetection", () => ({
  detectDeviceDetails: jest.fn(() => ({
    browser: "Chrome",
    os: "Windows",
    deviceType: "desktop",
    defaultName: "Chrome on Windows",
  })),
  DEVICE_NICKNAME_PRESETS: ["Work Laptop", "Personal Phone"],
}));

jest.mock("@/lib/auth/passkeys/client", () => ({
  savePasskeyChallengeToSession: jest.fn(),
  clearPasskeyChallengeFromSession: jest.fn(),
  setupPasskeyUnloadCleanup: jest.fn(() => jest.fn()),
}));

describe("PasskeyManager inline rename and nickname editing (#4604)", () => {
  const mockPasskey = {
    id: "cred-1",
    credentialId: "credential-id-123",
    name: "MacBook Touch ID",
    deviceType: "multiDevice",
    backedUp: true,
    transports: ["internal"],
    createdAt: "2026-01-01T00:00:00.000Z",
    lastUsedAt: "2026-01-02T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const urlStr = url.toString();
      if (urlStr === "/api/auth/passkey/credentials") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credentials: [mockPasskey] }),
        } as Response);
      }
      if (urlStr === "/api/auth/passkey/rotation") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ credentials: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;
  });

  it("renders registered passkey nickname and switches to input on edit pencil button click", async () => {
    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toHaveTextContent(
        "MacBook Touch ID",
      );
    });

    const editBtn = screen.getByTestId("edit-nickname-btn-cred-1");
    fireEvent.click(editBtn);

    const input = screen.getByTestId("rename-input-cred-1") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("MacBook Touch ID");
  });

  it("switches to inline input on double-clicking passkey name", async () => {
    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
    });

    fireEvent.doubleClick(screen.getByTestId("passkey-name-cred-1"));

    expect(screen.getByTestId("rename-input-cred-1")).toBeInTheDocument();
  });

  it("cancels inline editing when Escape key is pressed", async () => {
    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-nickname-btn-cred-1"));
    const input = screen.getByTestId("rename-input-cred-1");

    fireEvent.change(input, { target: { value: "Changed Name" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByTestId("rename-input-cred-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("passkey-name-cred-1")).toHaveTextContent(
      "MacBook Touch ID",
    );
  });

  it("cancels inline editing when Cancel button is clicked", async () => {
    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-nickname-btn-cred-1"));
    fireEvent.click(screen.getByTestId("cancel-rename-cred-1"));

    expect(screen.queryByTestId("rename-input-cred-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
  });

  it("saves new nickname optimistically and calls PATCH endpoint when Enter is pressed", async () => {
    let resolvePatch!: (value: Response) => void;
    const patchPromise = new Promise<Response>((resolve) => {
      resolvePatch = resolve;
    });

    (global.fetch as jest.Mock).mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr === "/api/auth/passkey/credentials") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credentials: [mockPasskey] }),
          } as Response);
        }
        if (urlStr === "/api/auth/passkey/rotation") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credentials: [] }),
          } as Response);
        }
        if (
          urlStr === "/api/auth/passkey/credentials/cred-1" &&
          init?.method === "PATCH"
        ) {
          return patchPromise;
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      },
    );

    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-nickname-btn-cred-1"));
    const input = screen.getByTestId("rename-input-cred-1");

    fireEvent.change(input, { target: { value: "Office Workstation Key" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Optimistic update should display immediately
    expect(screen.getByTestId("passkey-name-cred-1")).toHaveTextContent(
      "Office Workstation Key",
    );

    // Resolve API call
    resolvePatch({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/passkey/credentials/cred-1",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Office Workstation Key" }),
        }),
      );
    });

    expect(
      screen.getByText('Passkey renamed to "Office Workstation Key".'),
    ).toBeInTheDocument();
  });

  it("saves new nickname when Save button is clicked", async () => {
    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-nickname-btn-cred-1"));
    const input = screen.getByTestId("rename-input-cred-1");

    fireEvent.change(input, { target: { value: "New YubiKey 5C" } });
    fireEvent.click(screen.getByTestId("save-rename-cred-1"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/auth/passkey/credentials/cred-1",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "New YubiKey 5C" }),
        }),
      );
    });

    expect(screen.getByTestId("passkey-name-cred-1")).toHaveTextContent(
      "New YubiKey 5C",
    );
  });

  it("reverts optimistic nickname update when PATCH request fails", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      (url: RequestInfo | URL, init?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr === "/api/auth/passkey/credentials") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credentials: [mockPasskey] }),
          } as Response);
        }
        if (urlStr === "/api/auth/passkey/rotation") {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ credentials: [] }),
          } as Response);
        }
        if (
          urlStr === "/api/auth/passkey/credentials/cred-1" &&
          init?.method === "PATCH"
        ) {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({ error: "Failed to update credential nickname" }),
          } as Response);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      },
    );

    render(<PasskeyManager />);

    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("edit-nickname-btn-cred-1"));
    const input = screen.getByTestId("rename-input-cred-1");

    fireEvent.change(input, { target: { value: "Failing Name" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Expect revert on error
    await waitFor(() => {
      expect(screen.getByTestId("passkey-name-cred-1")).toHaveTextContent(
        "MacBook Touch ID",
      );
    });

    expect(
      screen.getByText("Failed to update credential nickname"),
    ).toBeInTheDocument();
  });
});
