import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import PasskeySecurityAuditLog from "@/components/auth/PasskeySecurityAuditLog";
import { PasskeyAuditLogEntry, SecurityStats } from "@/lib/auth/passkeys/server/auditLog";

const mockStats: SecurityStats = {
  totalEvents: 12,
  successfulLogins: 9,
  failedAttempts: 1,
  lastActive: "2026-10-28T12:00:00.000Z",
  overallSecurityHealth: "EXCELLENT",
  recentRiskAlerts: 0,
};

const mockLogs: PasskeyAuditLogEntry[] = [
  {
    id: "log-1",
    userId: "usr-1",
    credentialId: "cred-1",
    credentialName: "MacBook Pro TouchID",
    action: "AUTHENTICATE",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "macOS • Chrome",
    iconType: "laptop",
    timestamp: "2026-10-28T10:30:00.000Z",
    details: "UV passkey authentication successful",
    riskLevel: "low",
  },
  {
    id: "log-2",
    userId: "usr-1",
    credentialId: "cred-2",
    credentialName: "YubiKey 5C NFC",
    action: "REGISTER",
    status: "SUCCESS",
    ipAddress: "192.168.1.101",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "Windows • Edge",
    iconType: "key",
    timestamp: "2026-10-28T09:15:00.000Z",
    details: "New hardware key enrolled",
    riskLevel: "low",
  },
  {
    id: "log-3",
    userId: "usr-1",
    credentialId: "cred-3",
    credentialName: "iPhone FaceID",
    action: "STEP_UP",
    status: "FAILURE",
    ipAddress: "203.0.113.195",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "iOS • Safari",
    iconType: "phone",
    timestamp: "2026-10-28T08:00:00.000Z",
    details: "Biometric validation cancelled by user",
    riskLevel: "medium",
  },
  {
    id: "log-4",
    userId: "usr-1",
    credentialName: "Backup Security Key",
    action: "REVOKE",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "macOS • Chrome",
    iconType: "shield",
    timestamp: "2026-10-28T07:00:00.000Z",
    details: "Key decommissioned",
    riskLevel: "low",
  },
  {
    id: "log-5",
    userId: "usr-1",
    credentialName: "Work Laptop",
    action: "RENAME",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "macOS • Safari",
    iconType: "desktop",
    timestamp: "2026-10-28T06:00:00.000Z",
    details: "Nickname updated",
    riskLevel: "low",
  },
  {
    id: "log-6",
    userId: "usr-1",
    credentialName: "Corporate YubiKey",
    action: "ROTATE",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "macOS • Firefox",
    iconType: "tablet",
    timestamp: "2026-10-28T05:00:00.000Z",
    details: "Credential rotated",
    riskLevel: "low",
  },
  {
    id: "log-7",
    userId: "usr-1",
    credentialName: "Auth OTP",
    action: "OTP_REQUEST",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "macOS • Chrome",
    iconType: "phone",
    timestamp: "2026-10-28T04:00:00.000Z",
    details: "Code sent via email",
    riskLevel: "low",
  },
  {
    id: "log-8",
    userId: "usr-1",
    credentialName: "Auth OTP",
    action: "OTP_VERIFY",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 ...",
    deviceSummary: "macOS • Chrome",
    iconType: "phone",
    timestamp: "2026-10-28T04:01:00.000Z",
    details: "Code verified",
    riskLevel: "low",
  },
];

describe("PasskeySecurityAuditLog Component", () => {
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    jest.clearAllMocks();

    global.fetch = jest.fn((url: RequestInfo | URL) => {
      const u = url.toString();
      if (u.includes("/api/auth/passkey/audit-log")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              logs: mockLogs,
              stats: mockStats,
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    });

    originalCreateElement = document.createElement.bind(document);
  });

  afterEach(() => {
    document.createElement = originalCreateElement;
  });

  describe("Initial Loading & Structure", () => {
    it("renders loading state initially before fetch resolves", () => {
      // Mock fetch with a promise that hasn't resolved yet
      global.fetch = jest.fn(() => new Promise(() => {}));

      render(<PasskeySecurityAuditLog />);

      expect(screen.getByTestId("passkey-security-audit-log")).toBeInTheDocument();
      expect(screen.getByTestId("audit-loading-state")).toBeInTheDocument();
      expect(screen.getByText("Loading passkey security audit logs...")).toBeInTheDocument();

      const refreshBtn = screen.getByTestId("audit-refresh-btn");
      expect(refreshBtn).toBeDisabled();
      expect(refreshBtn).toHaveAttribute("type", "button");
      expect(refreshBtn).toHaveAttribute("aria-label", "Refresh logs");
    });
  });

  describe("Stats & Log Entries Rendering", () => {
    it("renders security posture cards and telemetry stats correctly", async () => {
      const onLogsLoaded = jest.fn();
      render(<PasskeySecurityAuditLog onLogsLoaded={onLogsLoaded} />);

      await waitFor(() => {
        expect(screen.queryByTestId("audit-loading-state")).not.toBeInTheDocument();
      });

      expect(screen.getByTestId("security-stats-grid")).toBeInTheDocument();
      expect(screen.getByTestId("health-value-excellent")).toHaveTextContent("Excellent");
      expect(screen.getByTestId("stats-successful-logins")).toHaveTextContent("9");
      expect(screen.getByTestId("stats-failed-attempts")).toHaveTextContent("1");
      expect(screen.getByTestId("stats-total-events")).toHaveTextContent("12");

      expect(onLogsLoaded).toHaveBeenCalledWith(mockLogs);
    });

    it("renders appropriate posture indicator when overallSecurityHealth is GOOD or ATTENTION_REQUIRED", async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              logs: mockLogs,
              stats: {
                ...mockStats,
                overallSecurityHealth: "GOOD",
              },
            }),
        } as Response),
      );

      const { rerender } = render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.getByTestId("health-value-good")).toHaveTextContent("Protected");
      });

      // Rerender with ATTENTION_REQUIRED
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              logs: mockLogs,
              stats: {
                ...mockStats,
                overallSecurityHealth: "ATTENTION_REQUIRED",
              },
            }),
        } as Response),
      );

      rerender(<PasskeySecurityAuditLog />);
      fireEvent.click(screen.getByTestId("audit-refresh-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("health-value-attention")).toHaveTextContent("Needs Review");
      });
    });

    it("renders audit log list items with icons, action badges, and status", async () => {
      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.getByTestId("audit-logs-list")).toBeInTheDocument();
      });

      // Item 1: MacBook Pro TouchID - AUTHENTICATE - SUCCESS
      expect(screen.getByTestId("audit-log-name-log-1")).toHaveTextContent("MacBook Pro TouchID");
      expect(screen.getByTestId("badge-action-AUTHENTICATE")).toBeInTheDocument();
      expect(screen.getByTestId("audit-log-status-log-1")).toHaveTextContent("OK");
      expect(screen.getByTestId("audit-log-details-log-1")).toHaveTextContent("UV passkey authentication successful");
      expect(screen.getByTestId("audit-log-device-log-1")).toHaveTextContent("Device: macOS • Chrome");
      expect(screen.getByTestId("audit-log-ip-log-1")).toHaveTextContent("IP: 192.168.1.100");

      // Item 2: Key registration
      expect(screen.getByTestId("badge-action-REGISTER")).toBeInTheDocument();

      // Item 3: Failed Step-Up
      expect(screen.getByTestId("audit-log-status-log-3")).toHaveTextContent("Failed");
      expect(screen.getByTestId("badge-action-STEP_UP")).toBeInTheDocument();

      // Badges for other actions
      expect(screen.getByTestId("badge-action-REVOKE")).toBeInTheDocument();
      expect(screen.getByTestId("badge-action-RENAME")).toBeInTheDocument();
      expect(screen.getByTestId("badge-action-ROTATE")).toBeInTheDocument();
      expect(screen.getByTestId("badge-action-OTP_REQUEST")).toBeInTheDocument();
      expect(screen.getByTestId("badge-action-OTP_VERIFY")).toBeInTheDocument();
    });
  });

  describe("Filtering by Action", () => {
    it("updates filter and issues network request with action query parameter", async () => {
      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.queryByTestId("audit-loading-state")).not.toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledWith("/api/auth/passkey/audit-log");

      // Click "Logins" (AUTHENTICATE)
      fireEvent.click(screen.getByTestId("audit-filter-AUTHENTICATE"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/passkey/audit-log?action=AUTHENTICATE");
      });

      // Click "Registered" (REGISTER)
      fireEvent.click(screen.getByTestId("audit-filter-REGISTER"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/passkey/audit-log?action=REGISTER");
      });

      // Click "All Events" (ALL)
      fireEvent.click(screen.getByTestId("audit-filter-ALL"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/passkey/audit-log");
      });
    });

    it("respects initialFilter prop", async () => {
      render(<PasskeySecurityAuditLog initialFilter="REVOKE" />);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/auth/passkey/audit-log?action=REVOKE");
      });
    });
  });

  describe("Refresh & Export JSON", () => {
    it("re-fetches audit logs when clicking refresh button", async () => {
      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.queryByTestId("audit-loading-state")).not.toBeInTheDocument();
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("audit-refresh-btn"));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
      });
    });

    it("triggers JSON file download on Export JSON click", async () => {
      const clickMock = jest.fn();
      const appendChildSpy = jest.spyOn(document.body, "appendChild");
      const removeSpy = jest.spyOn(HTMLElement.prototype, "remove");

      jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
        const el = originalCreateElement(tagName);
        if (tagName === "a") {
          el.click = clickMock;
        }
        return el;
      });

      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.queryByTestId("audit-loading-state")).not.toBeInTheDocument();
      });

      const exportBtn = screen.getByTestId("audit-export-btn");
      expect(exportBtn).not.toBeDisabled();
      expect(exportBtn).toHaveAttribute("type", "button");

      fireEvent.click(exportBtn);

      expect(clickMock).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalled();
    });
  });

  describe("Empty State & Disabled Export", () => {
    it("renders empty state placeholder when no logs are returned and disables export button", async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              logs: [],
              stats: {
                totalEvents: 0,
                successfulLogins: 0,
                failedAttempts: 0,
                lastActive: null,
                overallSecurityHealth: "GOOD",
                recentRiskAlerts: 0,
              },
            }),
        } as Response),
      );

      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.getByTestId("audit-empty-state")).toBeInTheDocument();
      });

      expect(screen.getByText("No passkey security logs yet")).toBeInTheDocument();
      expect(screen.getByTestId("audit-export-btn")).toBeDisabled();
    });
  });

  describe("Error Handling", () => {
    it("displays error alert banner when API returns error and allows retry", async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error("Network connection dropped"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              logs: mockLogs,
              stats: mockStats,
            }),
        } as Response);

      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      expect(screen.getByTestId("audit-error-banner")).toHaveTextContent("Network connection dropped");

      // Click retry
      fireEvent.click(screen.getByTestId("audit-error-retry-btn"));

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByTestId("audit-logs-list")).toBeInTheDocument();
      });
    });

    it("displays error banner when response status is not ok", async () => {
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response),
      );

      render(<PasskeySecurityAuditLog />);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });

      expect(screen.getByTestId("audit-error-banner")).toHaveTextContent("Failed to fetch audit log (status 500)");
    });
  });

  describe("Lifecycle & Polling", () => {
    it("handles unmounting safely while request is in flight", () => {
      let resolvePromise: (value: any) => void;
      global.fetch = jest.fn(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
      );

      const { unmount } = render(<PasskeySecurityAuditLog />);
      expect(screen.getByTestId("audit-loading-state")).toBeInTheDocument();

      // Unmount before fetch resolves
      unmount();

      // Resolve afterwards - should not throw React state update on unmounted component
      expect(() => {
        act(() => {
          resolvePromise({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                success: true,
                logs: mockLogs,
                stats: mockStats,
              }),
          });
        });
      }).not.toThrow();
    });

    it("polls when pollInterval is set", async () => {
      jest.useFakeTimers();

      render(<PasskeySecurityAuditLog pollInterval={5000} />);

      await act(async () => {
        jest.advanceTimersByTime(0);
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      expect(global.fetch).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });
});
