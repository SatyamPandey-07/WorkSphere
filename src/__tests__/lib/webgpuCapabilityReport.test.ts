import {
  normalizeWebGpuCapabilityReport,
  summarizeWebGpuCapabilityReports,
} from "@/lib/webgpu/capabilityReport";

const report = {
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

describe("WebGPU capability privacy normalization", () => {
  it("accepts the coarse allowlisted report schema", () => {
    expect(normalizeWebGpuCapabilityReport(report)).toEqual(report);
  });

  it("rejects raw numeric limits and malformed feature values", () => {
    expect(
      normalizeWebGpuCapabilityReport({
        ...report,
        limits: { ...report.limits, bufferSize: 1_073_741_824 },
      }),
    ).toBeNull();
    expect(
      normalizeWebGpuCapabilityReport({
        ...report,
        features: { ...report.features, shaderF16: "yes" },
      }),
    ).toBeNull();
  });

  it("forces unavailable capabilities to non-supported values", () => {
    const unavailable = normalizeWebGpuCapabilityReport({
      ...report,
      adapterAvailable: false,
    });
    expect(unavailable?.adapterAvailable).toBe(false);
    expect(unavailable?.features).toEqual({
      timestampQuery: false,
      shaderF16: false,
      subgroups: false,
    });
    expect(unavailable?.limits.bufferSize).toBe("unavailable");
  });

  it("summarizes capability reports without exposing per-admin identities", () => {
    const summary = summarizeWebGpuCapabilityReports([
      {
        details: JSON.stringify(report),
        createdAt: "2026-11-19T12:00:00.000Z",
      },
      {
        details: JSON.stringify({ ...report, adapterAvailable: false }),
        createdAt: "2026-11-19T13:00:00.000Z",
      },
      {
        details: "not-json",
        createdAt: "2026-11-19T14:00:00.000Z",
      },
    ]);

    expect(summary).toEqual({
      sampleCount: 2,
      adaptersAvailable: 1,
      featureSupport: {
        timestampQuery: 1,
        shaderF16: 0,
        subgroups: 1,
      },
      latestReportAt: "2026-11-19T14:00:00.000Z",
    });
    expect(JSON.stringify(summary)).not.toContain("adminId");
  });
});
