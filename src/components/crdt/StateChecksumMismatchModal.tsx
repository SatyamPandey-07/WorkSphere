/**
 * StateChecksumMismatchModal.tsx
 *
 * User-facing recovery modal and diagnostic reporting when a CRDT snapshot
 * cryptographic SHA-256 state vector integrity checksum mismatch is detected.
 *
 * Provides three distinct, real recovery workflows:
 * 1. "Re-sync from Authority": Pulls fresh full authoritative snapshot, validates checksum, and clears divergence.
 * 2. "Export Local Snapshot for Diagnostics": Exports downloadable diagnostic JSON without mutating state.
 * 3. "Force Overwrite": Explicitly confirmed destructive action overwriting remote authority with local snapshot.
 */

"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Download,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  X,
} from "lucide-react";

export interface VectorClockDiff {
  nodeId: string;
  localTime: number;
  authorityTime: number;
  delta: number;
}

export interface ChecksumMismatchDiagnostics {
  documentId: string;
  expectedChecksum: string;
  computedChecksum: string;
  timestamp: number;
  localVector?: Record<string, number>;
  authorityVector?: Record<string, number>;
  vectorClockDiffs?: VectorClockDiff[];
  rawSnapshot?: Uint8Array | null;
  errorMessage?: string;
}

export interface StateChecksumMismatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagnostics: ChecksumMismatchDiagnostics;
  onResyncFromAuthority: () => Promise<void>;
  onForceOverwrite?: () => Promise<void>;
  onExportSnapshot?: (diagnostics: ChecksumMismatchDiagnostics) => void;
  canForceOverwrite?: boolean;
}

export const StateChecksumMismatchModal: React.FC<StateChecksumMismatchModalProps> = ({
  isOpen,
  onClose,
  diagnostics,
  onResyncFromAuthority,
  onForceOverwrite,
  onExportSnapshot,
  canForceOverwrite = true,
}) => {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showForceConfirm, setShowForceConfirm] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isOverwriting, setIsOverwriting] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<"idle" | "success" | "error">("idle");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<"expected" | "computed" | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Capture focus before opening and return it upon closing
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
    } else {
      previousActiveElement.current?.focus();
      // Reset state on close
      setShowForceConfirm(false);
      setRecoveryStatus("idle");
      setFeedbackMessage(null);
    }
  }, [isOpen]);

  // Handle ESC key navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        if (showForceConfirm) {
          setShowForceConfirm(false);
        } else if (!isRecovering && !isOverwriting) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showForceConfirm, isRecovering, isOverwriting, onClose]);

  if (!isOpen) return null;

  // 1. Re-sync from Authority action handler
  const handleResync = async () => {
    if (isRecovering || isOverwriting) return;
    setIsRecovering(true);
    setRecoveryStatus("idle");
    setFeedbackMessage(null);

    try {
      await onResyncFromAuthority();
      setRecoveryStatus("success");
      setFeedbackMessage("Document successfully re-synchronized from authority.");
    } catch (err: unknown) {
      setRecoveryStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to re-sync from authority.";
      setFeedbackMessage(msg);
    } finally {
      setIsRecovering(false);
    }
  };

  // 2. Export local snapshot handler
  const handleExport = () => {
    if (onExportSnapshot) {
      onExportSnapshot(diagnostics);
      return;
    }

    // Default real browser JSON download
    try {
      let snapshotBase64: string | undefined;
      if (diagnostics.rawSnapshot) {
        if (typeof Buffer !== "undefined") {
          snapshotBase64 = Buffer.from(diagnostics.rawSnapshot).toString("base64");
        } else {
          let binary = "";
          const bytes = diagnostics.rawSnapshot;
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          snapshotBase64 = btoa(binary);
        }
      }

      const exportPayload = {
        documentId: diagnostics.documentId,
        expectedSha256: diagnostics.expectedChecksum,
        computedSha256: diagnostics.computedChecksum,
        verificationTimestamp: new Date(diagnostics.timestamp).toISOString(),
        timestampMs: diagnostics.timestamp,
        localStateVector: diagnostics.localVector ?? {},
        authorityStateVector: diagnostics.authorityVector ?? {},
        vectorClockDeltas: diagnostics.vectorClockDiffs ?? [],
        errorMessage: diagnostics.errorMessage,
        snapshotPayloadBase64: snapshotBase64,
      };

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `crdt-diagnostic-${diagnostics.documentId}-${diagnostics.timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[StateChecksumVerifier] Export failed:", err);
    }
  };

  // 3. Force Overwrite action handler
  const handleForceOverwrite = async () => {
    if (!onForceOverwrite || isOverwriting || isRecovering) return;
    setIsOverwriting(true);
    setRecoveryStatus("idle");
    setFeedbackMessage(null);

    try {
      await onForceOverwrite();
      setRecoveryStatus("success");
      setFeedbackMessage("Authoritative state overwritten with local snapshot.");
      setShowForceConfirm(false);
    } catch (err: unknown) {
      setRecoveryStatus("error");
      const msg = err instanceof Error ? err.message : "Failed to force overwrite authority state.";
      setFeedbackMessage(msg);
    } finally {
      setIsOverwriting(false);
    }
  };

  const handleCopyHash = async (hash: string, type: "expected" | "computed") => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(type);
      setTimeout(() => setCopiedHash(null), 2000);
    } catch {
      // Fallback or ignore
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="crdt-checksum-modal-title"
      aria-describedby="crdt-checksum-modal-desc"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRecovering && !isOverwriting) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl bg-card border border-border shadow-2xl p-6 text-card-foreground focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="crdt-checksum-modal-title"
                className="text-lg font-semibold tracking-tight text-foreground"
              >
                State Synchronization Issue Detected
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Document ID:{" "}
                <span className="font-mono font-medium text-foreground">
                  {diagnostics.documentId}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isRecovering || isOverwriting}
            aria-label="Close modal"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Non-technical explanation */}
        <div className="mt-4">
          <p id="crdt-checksum-modal-desc" className="text-sm text-muted-foreground leading-relaxed">
            The collaborative state on your device differs from the verified shared state on the
            server. This can happen due to unexpected network interruptions or concurrent offline
            edits. Recovery options are available below to restore normal synchronization.
          </p>
        </div>

        {/* Feedback alert banner */}
        {feedbackMessage && (
          <div
            role="status"
            className={`mt-4 p-3 rounded-lg flex items-start gap-2.5 text-sm ${
              recoveryStatus === "success"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 border border-destructive/20 text-destructive"
            }`}
          >
            {recoveryStatus === "success" ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="flex-1 text-xs sm:text-sm">{feedbackMessage}</span>
          </div>
        )}

        {/* Technical Trace Collapsible Section */}
        <div className="mt-4 border border-border/60 rounded-lg overflow-hidden bg-muted/30">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-expanded={showTechnicalDetails}
            aria-controls="technical-trace-content"
          >
            <span>Technical Diagnostics Trace</span>
            {showTechnicalDetails ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showTechnicalDetails && (
            <div id="technical-trace-content" className="p-3.5 border-t border-border/60 space-y-3 font-mono text-xs">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-1">
                  <span>Expected SHA-256 (Authority):</span>
                  <button
                    onClick={() => handleCopyHash(diagnostics.expectedChecksum, "expected")}
                    className="flex items-center gap-1 hover:text-foreground text-[10px]"
                    title="Copy expected checksum"
                  >
                    {copiedHash === "expected" ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedHash === "expected" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="bg-background/80 p-2 rounded border border-border/50 text-[11px] break-all select-all text-amber-500">
                  {diagnostics.expectedChecksum || "—"}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-1">
                  <span>Computed SHA-256 (Local):</span>
                  <button
                    onClick={() => handleCopyHash(diagnostics.computedChecksum, "computed")}
                    className="flex items-center gap-1 hover:text-foreground text-[10px]"
                    title="Copy computed checksum"
                  >
                    {copiedHash === "computed" ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedHash === "computed" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="bg-background/80 p-2 rounded border border-border/50 text-[11px] break-all select-all text-red-500">
                  {diagnostics.computedChecksum || "—"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-muted-foreground">Verification Time:</span>
                  <div className="text-foreground mt-0.5">
                    {new Date(diagnostics.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Diverged Peers:</span>
                  <div className="text-foreground mt-0.5">
                    {diagnostics.vectorClockDiffs?.length ?? 0} node(s)
                  </div>
                </div>
              </div>

              {diagnostics.vectorClockDiffs && diagnostics.vectorClockDiffs.length > 0 && (
                <div>
                  <span className="text-muted-foreground block mb-1">Vector Clock Differences:</span>
                  <div className="max-h-28 overflow-y-auto rounded border border-border/50 bg-background/80 divide-y divide-border/40 text-[10px]">
                    {diagnostics.vectorClockDiffs.map((diff) => (
                      <div key={diff.nodeId} className="p-1.5 flex justify-between items-center">
                        <span className="text-foreground font-semibold">{diff.nodeId}</span>
                        <span className="text-muted-foreground">
                          Local: {diff.localTime} | Auth: {diff.authorityTime} (Δ {diff.delta > 0 ? `+${diff.delta}` : diff.delta})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diagnostics.errorMessage && (
                <div>
                  <span className="text-muted-foreground block mb-1">Error Details:</span>
                  <div className="text-destructive text-[11px] bg-destructive/10 p-2 rounded border border-destructive/20">
                    {diagnostics.errorMessage}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Primary Recovery Actions */}
        <div className="mt-6 space-y-3">
          {/* Action 1: Re-sync from Authority */}
          <button
            type="button"
            onClick={handleResync}
            disabled={isRecovering || isOverwriting}
            className="w-full flex items-center justify-between p-3.5 rounded-lg border border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary transition-colors disabled:opacity-50 text-left"
          >
            <div className="flex items-center gap-3">
              <RefreshCw className={`w-5 h-5 shrink-0 ${isRecovering ? "animate-spin" : ""}`} />
              <div>
                <div className="text-sm font-semibold">Re-sync from Authority</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Discard unverified local differences and pull the latest authoritative snapshot.
                </div>
              </div>
            </div>
            {isRecovering && <span className="text-xs font-medium">Re-syncing...</span>}
          </button>

          {/* Action 2: Export Local Snapshot for Diagnostics */}
          <button
            type="button"
            onClick={handleExport}
            disabled={isRecovering || isOverwriting}
            className="w-full flex items-center justify-between p-3.5 rounded-lg border border-border bg-card hover:bg-muted/50 text-foreground transition-colors disabled:opacity-50 text-left"
          >
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <div className="text-sm font-semibold">Export Local Snapshot for Diagnostics</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Save diagnostic report and local CRDT state to a JSON file without altering state.
                </div>
              </div>
            </div>
          </button>

          {/* Action 3: Force Overwrite (with explicit confirmation flow) */}
          {canForceOverwrite && onForceOverwrite && (
            <div className="pt-2 border-t border-border">
              {!showForceConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowForceConfirm(true)}
                  disabled={isRecovering || isOverwriting}
                  className="w-full flex items-center gap-2 p-3 text-xs font-medium text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                >
                  <AlertOctagon className="w-4 h-4 shrink-0" />
                  <span>Force Overwrite (Advanced & Destructive)</span>
                </button>
              ) : (
                <div className="p-3.5 rounded-lg border border-destructive/30 bg-destructive/5 space-y-3 animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <AlertOctagon className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-xs font-semibold text-destructive">
                        Confirm Destructive Overwrite
                      </h4>
                      <p className="text-xs text-muted-foreground mt-1 leading-normal">
                        This action will overwrite the remote authoritative state with your local state.
                        Any remote edits made by other collaborators since divergence will be permanently overwritten.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowForceConfirm(false)}
                      disabled={isOverwriting}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleForceOverwrite}
                      disabled={isOverwriting}
                      className="px-3 py-1.5 text-xs font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isOverwriting && <RefreshCw className="w-3 h-3 animate-spin" />}
                      <span>{isOverwriting ? "Overwriting..." : "Confirm Overwrite"}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-5 pt-3 border-t border-border/50 flex justify-between items-center text-[11px] text-muted-foreground">
          <span>Local changes are preserved until a recovery action succeeds.</span>
          <button
            type="button"
            onClick={onClose}
            disabled={isRecovering || isOverwriting}
            className="hover:text-foreground underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default StateChecksumMismatchModal;
