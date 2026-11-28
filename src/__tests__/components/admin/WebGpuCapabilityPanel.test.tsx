import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WebGpuCapabilityPanel } from "@/components/admin/WebGpuCapabilityPanel";
import {
  buildWebGpuDiagnosticExportPayload,
  formatWebGpuDiagnosticJson,
  sanitizeDiagnosticString,
  type WebGpuCapabilityReport,
} from "@/lib/webgpu/capabilityReport";

const mockReport: WebGpuCapabilityReport = {
  version: 1,
  adapterAvailable: true,
  features: {
    timestampQuery: true,
    shaderF16: false,
    subgroups: true,
  },
  limits: {
    bufferSize: "large",
    workgroupSizeX: "medium",
    workgroupInvocations: "large",
    workgroupsPerDimension: "very-large",
  },
};

jest.mock("@/lib/webgpu/capabilityReport", () => {
  const actual = jest.requireActual("@/lib/webgpu/capabilityReport");
  return {
    ...actual,
    collectWebGpuCapabilityReport: jest.fn(),
  };
});

import { collectWebGpuCapabilityReport } from "@/lib/webgpu/capabilityReport";

describe("WebGpuCapabilityPanel JSON export and sanitization (#9259)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (collectWebGpuCapabilityReport as jest.Mock).mockResolvedValue(mockReport);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }) as unknown as typeof fetch;
  });

  it("sanitizes private IP addresses and sensitive tokens from diagnostic strings", () => {
    const raw =
      "Mozilla/5.0 host=192.168.1.42 internal=10.0.0.8 Bearer secretToken123456 sk_live_9876543210abcdef";
    const sanitized = sanitizeDiagnosticString(raw);

    expect(sanitized).not.toContain("192.168.1.42");
    expect(sanitized).not.toContain("10.0.0.8");
    expect(sanitized).not.toContain("secretToken123456");
    expect(sanitized).not.toContain("sk_live_9876543210abcdef");
    expect(sanitized).toContain("[REDACTED_IP]");
    expect(sanitized).toContain("[REDACTED_TOKEN]");
  });

  it("builds complete diagnostic payload and formats JSON with 2-space indentation", () => {
    const payload = buildWebGpuDiagnosticExportPayload(mockReport, {
      timestamp: "2026-11-27T10:00:00.000Z",
      userAgent: "TestAgent/1.0 (192.168.0.10)",
    });

    expect(payload).toEqual({
      timestamp: "2026-11-27T10:00:00.000Z",
      userAgent: "TestAgent/1.0 ([REDACTED_IP])",
      webgpuSupported: true,
      adapterInfo: {
        vendor: "redacted-coarse-only",
        architecture: "redacted-coarse-only",
        driver: "redacted-coarse-only",
      },
      features: ["timestampQuery", "subgroups"],
      limits: {
        bufferSize: "large",
        workgroupSizeX: "medium",
        workgroupInvocations: "large",
        workgroupsPerDimension: "very-large",
      },
    });

    const formatted = formatWebGpuDiagnosticJson(payload);
    expect(formatted).toContain('\n  "timestamp": "2026-11-27T10:00:00.000Z"');
    expect(() => JSON.parse(formatted)).not.toThrow();
  });

  it("serializes BigInt values in diagnostic JSON exports without losing precision", () => {
    const basePayload = buildWebGpuDiagnosticExportPayload(mockReport);
    const payload = {
      ...basePayload,
      limits: {
        ...basePayload.limits,
        maxBufferSize: 18446744073709551615n,
      },
    } as unknown as Parameters<typeof formatWebGpuDiagnosticJson>[0];

    const formatted = formatWebGpuDiagnosticJson(payload);

    expect(() => JSON.parse(formatted)).not.toThrow();
    expect(JSON.parse(formatted).limits.maxBufferSize).toBe(
      "18446744073709551615",
    );
  });

  it("triggers browser JSON file download and revokes Blob URL when Export Diagnostic Report (.json) is clicked", async () => {
    const createObjectURLMock = jest.fn(
      () => "blob:http://localhost/mock-uuid",
    );
    const revokeObjectURLMock = jest.fn();
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;

    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<WebGpuCapabilityPanel />);

    const exportBtn = await screen.findByTestId("export-webgpu-json-button");
    expect(exportBtn).toHaveAttribute(
      "aria-label",
      "Export Diagnostic Report (.json)",
    );

    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith(
      "blob:http://localhost/mock-uuid",
    );
    expect(
      screen.getByText("Diagnostic JSON report downloaded."),
    ).toBeInTheDocument();

    clickSpy.mockRestore();
  });

  it("copies formatted JSON to clipboard when Copy JSON button is clicked", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<WebGpuCapabilityPanel />);

    const copyBtn = await screen.findByTestId("copy-webgpu-json-button");
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });

    const copiedString = writeTextMock.mock.calls[0][0] as string;
    const parsed = JSON.parse(copiedString);
    expect(parsed.webgpuSupported).toBe(true);
    expect(parsed.features).toEqual(["timestampQuery", "subgroups"]);
    expect(parsed.limits.bufferSize).toBe("large");
  });

  it("shows all limits and features by default", async () => {
    render(<WebGpuCapabilityPanel />);

    expect(
      await screen.findByRole("radio", { name: "Show all" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Unsupported only" }),
    ).not.toBeChecked();
    expect(screen.getByText("timestampQuery: supported")).toBeInTheDocument();
    expect(screen.getByText("shaderF16: not reported")).toBeInTheDocument();
    expect(screen.getByText("subgroups: supported")).toBeInTheDocument();
    expect(screen.getByText("Buffer capacity")).toBeInTheDocument();
    expect(screen.getByText("Workgroup size X")).toBeInTheDocument();
    expect(screen.getByText("Workgroup invocations")).toBeInTheDocument();
    expect(screen.getByText("Workgroups per dimension")).toBeInTheDocument();
  });

  it("filters to unsupported capabilities and switches back to all", async () => {
    (collectWebGpuCapabilityReport as jest.Mock).mockResolvedValueOnce({
      ...mockReport,
      limits: {
        ...mockReport.limits,
        workgroupSizeX: "unavailable",
      },
    });
    render(<WebGpuCapabilityPanel />);

    const showAll = await screen.findByRole("radio", { name: "Show all" });
    const unsupportedOnly = screen.getByRole("radio", {
      name: "Unsupported only",
    });
    fireEvent.click(unsupportedOnly);

    expect(unsupportedOnly).toBeChecked();
    expect(screen.getByText("shaderF16: not reported")).toBeInTheDocument();
    expect(screen.getByText("Workgroup size X")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText("timestampQuery: supported"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Buffer capacity")).not.toBeInTheDocument();

    fireEvent.click(showAll);
    expect(showAll).toBeChecked();
    expect(screen.getByText("timestampQuery: supported")).toBeInTheDocument();
    expect(screen.getByText("Buffer capacity")).toBeInTheDocument();
  });

  it("shows an empty state when unsupported-only has no unsupported capabilities", async () => {
    (collectWebGpuCapabilityReport as jest.Mock).mockResolvedValueOnce({
      ...mockReport,
      features: {
        timestampQuery: true,
        shaderF16: true,
        subgroups: true,
      },
    });
    render(<WebGpuCapabilityPanel />);

    fireEvent.click(
      await screen.findByRole("radio", { name: "Unsupported only" }),
    );

    expect(
      screen.getByText(
        "No unsupported WebGPU limits or features were reported.",
      ),
    ).toHaveAttribute("role", "status");
    expect(
      screen.queryByText("timestampQuery: supported"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Buffer capacity")).not.toBeInTheDocument();
  });
});
