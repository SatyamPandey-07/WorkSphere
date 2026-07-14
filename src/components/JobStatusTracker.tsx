"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle, XCircle, Download } from "lucide-react";

interface JobStatusTrackerProps {
  jobId: string;
}

export function JobStatusTracker({ jobId }: JobStatusTrackerProps) {
  const [status, setStatus] = useState<string>("QUEUED");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line prefer-const
    let interval: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        
        setStatus(data.status);
        
        if (data.status === "COMPLETED") {
          setResultUrl(data.resultUrl);
          clearInterval(interval);
        } else if (data.status === "FAILED") {
          setError(data.error || "Job failed");
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Failed to fetch job status", err);
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [jobId]);

  return (
    <div className="p-6 border rounded-lg bg-gray-50/50 flex flex-col items-center justify-center space-y-4">
      {status === "QUEUED" && (
        <>
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-sm font-medium text-gray-700">Waiting in queue...</p>
        </>
      )}
      
      {status === "PROCESSING" && (
        <>
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm font-medium text-gray-700">Generating PDF and uploading to Cloudinary...</p>
        </>
      )}

      {status === "COMPLETED" && (
        <>
          <CheckCircle className="w-10 h-10 text-green-500" />
          <p className="text-sm font-medium text-green-700">Your PDF is ready!</p>
          {resultUrl && (
            <a 
              href={resultUrl} 
              target="_blank" 
              rel="noreferrer"
              className="mt-2 flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
            >
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </a>
          )}
        </>
      )}

      {status === "FAILED" && (
        <>
          <XCircle className="w-10 h-10 text-red-500" />
          <p className="text-sm font-medium text-red-700">Failed to generate PDF.</p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </>
      )}
    </div>
  );
}
