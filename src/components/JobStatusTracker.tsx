"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2, CheckCircle, XCircle, Download } from "lucide-react";

export interface JobStatusTrackerProps {
  /** The unique job ID to track */
  jobId: string;
  /** Optional polling interval in milliseconds (default: 2000) */
  pollIntervalMs?: number;
  /** Optional callback fired when job transitions to COMPLETED */
  onCompleted?: (resultUrl: string | null) => void;
  /** Optional callback fired when job transitions to FAILED */
  onFailed?: (error: string) => void;
  /** Optional custom CSS classes for the container */
  className?: string;
  /** Optional data-testid override for the root container */
  testId?: string;
}

export function JobStatusTracker({
  jobId,
  pollIntervalMs = 2000,
  onCompleted,
  onFailed,
  className = "",
  testId = "job-status-tracker",
}: JobStatusTrackerProps) {
  const [status, setStatus] = useState<string>("QUEUED");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (!jobId || !jobId.trim()) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId.trim())}`);
        if (!isMountedRef.current) return;
        if (!res.ok) return;

        const data = await res.json();
        if (!isMountedRef.current) return;

        setStatus(data.status);

        if (data.status === "COMPLETED") {
          setResultUrl(data.resultUrl || null);
          if (interval) clearInterval(interval);
          onCompleted?.(data.resultUrl || null);
        } else if (data.status === "FAILED") {
          const errMsg = data.error || "Job failed";
          setError(errMsg);
          if (interval) clearInterval(interval);
          onFailed?.(errMsg);
        }
      } catch (err) {
        if (isMountedRef.current) {
          console.error("Failed to fetch job status", err);
        }
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, pollIntervalMs);

    return () => {
      isMountedRef.current = false;
      if (interval) clearInterval(interval);
    };
  }, [jobId, pollIntervalMs, onCompleted, onFailed]);

  if (!jobId || !jobId.trim()) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={`p-6 border rounded-lg bg-gray-50/50 dark:bg-zinc-900/50 dark:border-zinc-800 flex flex-col items-center justify-center space-y-4 ${className}`.trim()}
    >
      {status === "QUEUED" && (
        <div className="flex flex-col items-center space-y-3" data-testid="job-status-queued">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" data-testid="job-queued-spinner" />
          <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
            Waiting in queue...
          </p>
        </div>
      )}

      {status === "PROCESSING" && (
        <div className="flex flex-col items-center space-y-3" data-testid="job-status-processing">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" data-testid="job-processing-spinner" />
          <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
            Generating PDF and uploading to Cloudinary...
          </p>
        </div>
      )}

      {status === "COMPLETED" && (
        <div className="flex flex-col items-center space-y-3" data-testid="job-status-completed">
          <CheckCircle className="w-10 h-10 text-green-500" data-testid="job-completed-icon" />
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Your PDF is ready!
          </p>
          {resultUrl && (
            <a
              href={resultUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="job-download-btn"
              className="mt-2 flex items-center px-4 py-2 accent-bg text-white rounded-md accent-bg-hover text-sm font-medium"
            >
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </a>
          )}
        </div>
      )}

      {status === "FAILED" && (
        <div className="flex flex-col items-center space-y-3" data-testid="job-status-failed">
          <XCircle className="w-10 h-10 text-red-500" data-testid="job-failed-icon" />
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            Failed to generate PDF.
          </p>
          {error && (
            <p className="text-xs text-red-500" data-testid="job-error-msg">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default JobStatusTracker;
