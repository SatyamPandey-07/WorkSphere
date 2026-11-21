"use client";

import { useEffect, useRef, useState } from "react";
import {
  collectWebGpuCapabilityReport,
  type WebGpuCapabilityReport,
} from "@/lib/webgpu/capabilityReport";

type SaveState = "checking" | "saving" | "saved" | "failed";

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
            {Object.entries(report.features).map(([key, supported]) => (
              <span
                key={key}
                className="rounded-lg border border-white/10 px-3 py-2 text-zinc-300"
              >
                {key}: {supported ? "supported" : "not reported"}
              </span>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {limitLabels.map((item) => (
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
        </>
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
