"use client";

import React, { useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface ReceiptDownloadButtonProps {
  bookingId: string;
  /** Used for the downloaded file name; falls back to `bookingId`. */
  confirmationId?: string | null;
  className?: string;
  testId?: string;
}

/**
 * Downloads a booking's PDF receipt (generated server-side with pdf-lib).
 *
 * While the PDF is being generated the button is disabled, marked
 * `aria-busy`, and shows a spinner with a pulse, so repeated clicks cannot
 * trigger duplicate builds (#7611). It is restored once the download starts or
 * the request fails.
 */
export function ReceiptDownloadButton({
  bookingId,
  confirmationId,
  className = "",
  testId,
}: ReceiptDownloadButtonProps) {
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  // Guards against a second click landing before the disabled state renders.
  const inFlightRef = useRef(false);

  const handleClick = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsGenerating(true);

    try {
      const res = await fetch(
        `/api/bookings/${encodeURIComponent(bookingId)}/download`,
      );
      if (!res.ok) {
        throw new Error(`Receipt request failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `WorkSphere_Receipt_${confirmationId || bookingId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Give the browser a moment to start the download before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("[Receipt download]", err);
      toast("Couldn't download the receipt. Please try again.", "error");
    } finally {
      inFlightRef.current = false;
      setIsGenerating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isGenerating}
      aria-busy={isGenerating}
      aria-label={isGenerating ? "Generating receipt" : "Download receipt"}
      data-testid={testId}
      className={`${className} disabled:cursor-wait disabled:opacity-70 ${
        isGenerating ? "animate-pulse" : ""
      }`}
    >
      {isGenerating ? (
        <Loader2
          className="w-3.5 h-3.5 animate-spin"
          aria-hidden="true"
          data-testid="receipt-download-spinner"
        />
      ) : (
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      {isGenerating ? "Generating…" : "Receipt"}
    </button>
  );
}

export default ReceiptDownloadButton;
