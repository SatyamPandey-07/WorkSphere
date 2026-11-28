"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildWebGpuDiagnosticExportPayload,
  collectWebGpuCapabilityReport,
  formatWebGpuDiagnosticJson,
  type WebGpuCapabilityReport,
} from "@/lib/webgpu/capabilityReport";

type SaveState = "checking" | "saving" | "saved" | "failed";
type ExportFeedback = "idle" | "exported" | "copied" | "failed";
type CapabilityFilter = "all" | "unsupported";

const limitLabels: Array<{
  key: keyof WebGpuCapabilityReport["limits"];
  label: string;
}> = [
  { key: "bufferSize", label: "Buffer capacity" },
  { key: "workgroupSizeX", label: "Workgroup size X" },
  { key: "workgroupInvocations", label: "Workgroup invocations" },
  { key: "workgroupsPerDimension", label: "Workgroups per dimension" },
];

export function WebGpuCapabilityPanel() {
  const [report, setReport] = useState<WebGpuCapabilityReport | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("checking");
  const [exportFeedback, setExportFeedback] = useState<ExportFeedback>("idle");
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    void (async () => {
      const collected = await collectWebGpuCapabilityReport();
      if (cancelled) return;
      setReport(collected);
      setSaveState("saving");

      try {
        const response = await fetch("/api/admin/system/diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(collected),
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(
            response.status === 403
              ? "Admin permission is required to submit capability telemetry."
              : "The capability report could not be saved.",
          );
        }
        if (!cancelled) setSaveState("saved");
      } catch (cause) {
        if (cancelled) return;
        setSaveState("failed");
        setError(
          cause instanceof Error
            ? cause.message
            : "The capability report could not be saved.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const buildFormattedReport = useCallback(() => {
    if (!report) return "";
    const payload = buildWebGpuDiagnosticExportPayload(report);
    return formatWebGpuDiagnosticJson(payload);
  }, [report]);

  const handleExportJson = useCallback(() => {
    if (!report) return;
    const formattedJson = buildFormattedReport();
    const filename = `worksphere-webgpu-diagnostic-${Date.now()}.json`;

    try {
      const blob = new Blob([formattedJson], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);

      try {
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setExportFeedback("exported");
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setExportFeedback("failed");
    }
  }, [report, buildFormattedReport]);

  const handleCopyJson = useCallback(async () => {
    if (!report) return;
    const formattedJson = buildFormattedReport();

    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(formattedJson);
        setExportFeedback("copied");
      } else {
        setExportFeedback("failed");
      }
    } catch {
      setExportFeedback("failed");
    }
  }, [report, buildFormattedReport]);

  const visibleFeatures = report
    ? Object.entries(report.features).filter(
        ([, supported]) =>
          capabilityFilter === "all" || !supported,
      )
    : [];
  const visibleLimits = report
    ? limitLabels.filter(
        (item) =>
          capabilityFilter === "all" ||
          report.limits[item.key] === "unavailable",
      )
    : [];

  return (
    <section
      className="mt-6 rounded-2xl border border-white/10 bg-zinc-950/50 p-5"
      data-testid="webgpu-capability-panel"
      aria-label="WebGPU adapter capability diagnostics"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            WebGPU Adapter Capabilities
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-zinc-400">
            Coarse capability buckets and allowlisted feature flags. Vendor,
            device, driver, and exact hardware limits are not collected.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {report && (
            <>
              <button
                type="button"
                onClick={handleExportJson}
                data-testid="export-webgpu-json-button"
                aria-label="Export Diagnostic Report (.json)"
                className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-400/70"
              >
                Export Diagnostic Report (.json)
              </button>
              <button
                type="button"
                onClick={() => void handleCopyJson()}
                data-testid="copy-webgpu-json-button"
                aria-label="Copy Diagnostic JSON to Clipboard"
                className="rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-indigo-400/70"
              >
                {exportFeedback === "copied" ? "Copied JSON" : "Copy JSON"}
              </button>
            </>
          )}

          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">
            {saveState === "checking"
              ? "Checking"
              : saveState === "saving"
                ? "Saving report"
                : saveState === "saved"
                  ? "Reported"
                  : "Local only"}
          </span>
        </div>
      </div>

      {report && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                report.adapterAvailable
                  ? "rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300"
                  : "rounded-lg bg-amber-500/10 px-3 py-2 text-amber-300"
              }
            >
              {report.adapterAvailable
                ? "WebGPU adapter available"
                : "WebGPU adapter unavailable"}
            </span>
          </div>

          <fieldset className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            <legend className="sr-only">Capabilities to display</legend>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="webgpu-capability-filter"
                value="all"
                checked={capabilityFilter === "all"}
                onChange={() => setCapabilityFilter("all")}
                className="accent-indigo-400"
              />
              Show all
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="webgpu-capability-filter"
                value="unsupported"
                checked={capabilityFilter === "unsupported"}
                onChange={() => setCapabilityFilter("unsupported")}
                className="accent-indigo-400"
              />
              Unsupported only
            </label>
          </fieldset>

          {visibleFeatures.length === 0 && visibleLimits.length === 0 ? (
            <p className="mt-4 text-xs text-zinc-400" role="status">
              No unsupported WebGPU limits or features were reported.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                {visibleFeatures.map(([key, supported]) => (
                  <span
                    key={key}
                    className="rounded-lg border border-white/10 px-3 py-2 text-zinc-300"
                  >
                    {key}: {supported ? "supported" : "not reported"}
                  </span>
                ))}
              </div>

              {visibleLimits.length > 0 && (
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {visibleLimits.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-xl border border-white/5 bg-white/[0.03] p-3"
                    >
                      <p className="text-[11px] text-zinc-500">{item.label}</p>
                      <p className="mt-1 text-sm font-semibold capitalize text-zinc-200">
                        {report.limits[item.key].replace("-", " ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {exportFeedback === "exported" && (
        <p className="mt-3 text-xs text-emerald-300" role="status">
          Diagnostic JSON report downloaded.
        </p>
      )}
      {exportFeedback === "copied" && (
        <p className="mt-3 text-xs text-emerald-300" role="status">
          Diagnostic JSON report copied to clipboard.
        </p>
      )}
      {exportFeedback === "failed" && (
        <p className="mt-3 text-xs text-amber-300" role="status">
          Unable to export diagnostic JSON report.
        </p>
      )}

      {error && (
        <p className="mt-3 text-xs text-amber-300" role="status">
          {error}
        </p>
      )}
    </section>
  );
}

export default WebGpuCapabilityPanel;