"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Copy,
  Check,
  ShieldCheck,
  Activity,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  BFTConsensusCoordinator,
  BlockProposal,
  QuorumCertificate,
} from "@/core/consensus/BFTConsensusCoordinator";

export interface BFTConsensusDashboardProps {
  coordinator?: BFTConsensusCoordinator;
  className?: string;
  autoRefreshIntervalMs?: number;
}

export interface ProposalDiagnosticEntry {
  sequence: number;
  view: number;
  proposerId: string;
  blockHash: string;
  parentHash: string;
  timestamp: number;
  status: "committed" | "pending" | "proposed";
}

/**
 * Fallback clipboard copy using document.execCommand('copy') for older browsers or insecure contexts.
 */
export function fallbackCopyTextToClipboard(text: string): boolean {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  textArea.setAttribute("aria-hidden", "true");

  try {
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand("copy");
    return successful;
  } catch (err) {
    console.error("Fallback copy error:", err);
    return false;
  } finally {
    if (textArea.parentNode) {
      textArea.parentNode.removeChild(textArea);
    }
  }
}

/**
 * Copies text using navigator.clipboard or fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback on clipboard write failure (e.g., permissions / insecure context)
      return fallbackCopyTextToClipboard(text);
    }
  }
  return fallbackCopyTextToClipboard(text);
}

export interface CopyButtonProps {
  value: string | number;
  label: string;
  tooltipText?: string;
  className?: string;
  testId?: string;
}

/**
 * Compact, accessible copy button for consensus diagnostic values.
 */
export function CopyButton({
  value,
  label,
  tooltipText,
  className = "",
  testId,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stringValue = String(value);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();

      if (!stringValue) return;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const success = await copyText(stringValue);
      if (success) {
        setCopied(true);
        setError(false);
        const timer = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, 2000);
        timer.unref?.();
        timerRef.current = timer;
      } else {
        setError(true);
        setCopied(false);
        const timer = setTimeout(() => {
          setError(false);
          timerRef.current = null;
        }, 2000);
        timer.unref?.();
        timerRef.current = timer;
      }
    },
    [stringValue],
  );

  if (!stringValue) {
    return null;
  }

  const ariaLabelText = copied
    ? `Copied ${label}`
    : error
      ? `Failed to copy ${label}`
      : `Copy ${label}`;
  const titleText =
    tooltipText ||
    (copied ? "Copied!" : error ? "Copy failed" : `Copy ${label}`);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={ariaLabelText}
      title={titleText}
      data-testid={testId || `copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={`inline-flex items-center justify-center p-1 rounded transition-colors text-zinc-400 hover:text-zinc-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900 ${
        copied
          ? "text-emerald-400 hover:text-emerald-300 bg-emerald-500/10"
          : error
            ? "text-red-400 hover:text-red-300 bg-red-500/10"
            : ""
      } ${className}`}
    >
      {copied ? (
        <Check
          className="w-3.5 h-3.5 text-emerald-400 animate-in zoom-in-50 duration-150"
          aria-hidden="true"
        />
      ) : (
        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      <span className="sr-only">
        {copied
          ? `Copied ${label} to clipboard`
          : error
            ? `Failed to copy ${label}`
            : `Copy ${label}`}
      </span>
    </button>
  );
}

export function BFTConsensusDashboard({
  coordinator,
  className = "",
  autoRefreshIntervalMs = 2000,
}: BFTConsensusDashboardProps) {
  const [currentView, setCurrentView] = useState(0);
  const [currentSequence, setCurrentSequence] = useState(0);
  const [currentLeader, setCurrentLeader] = useState("");
  const [validators, setValidators] = useState<string[]>([]);
  const [quorumSize, setQuorumSize] = useState(0);
  const [currentProposal, setCurrentProposal] = useState<BlockProposal | null>(
    null,
  );
  const [committedBlocks, setCommittedBlocks] = useState<BlockProposal[]>([]);
  const [lastCommitQC, setLastCommitQC] = useState<QuorumCertificate | null>(
    null,
  );

  const refreshState = useCallback(() => {
    if (!coordinator) return;
    setCurrentView(coordinator.getCurrentView());
    setCurrentSequence(coordinator.getCurrentSequence());
    setCurrentLeader(coordinator.getCurrentLeader());
    setValidators(coordinator.validators);
    setQuorumSize(coordinator.quorumSize);
    setCurrentProposal(coordinator.getCurrentProposal());
    setCommittedBlocks(coordinator.getCommittedBlocks());
    setLastCommitQC(coordinator.getLastCommitQC());
  }, [coordinator]);

  useEffect(() => {
    refreshState();
    if (autoRefreshIntervalMs > 0) {
      const interval = setInterval(refreshState, autoRefreshIntervalMs);
      return () => clearInterval(interval);
    }
  }, [refreshState, autoRefreshIntervalMs]);

  // Combine committed and current proposals
  const proposals: ProposalDiagnosticEntry[] = [];

  if (currentProposal) {
    proposals.push({
      sequence: currentProposal.sequence,
      view: currentProposal.view,
      proposerId: currentProposal.proposerId,
      blockHash: currentProposal.blockHash,
      parentHash: currentProposal.parentHash,
      timestamp: currentProposal.timestamp,
      status: "proposed",
    });
  }

  for (let i = committedBlocks.length - 1; i >= 0; i--) {
    const block = committedBlocks[i];
    if (!currentProposal || block.blockHash !== currentProposal.blockHash) {
      proposals.push({
        sequence: block.sequence,
        view: block.view,
        proposerId: block.proposerId,
        blockHash: block.blockHash,
        parentHash: block.parentHash,
        timestamp: block.timestamp,
        status: "committed",
      });
    }
  }

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-zinc-950 p-6 text-white shadow-xl ${className}`}
      data-testid="bft-consensus-dashboard"
      aria-label="BFT Consensus Diagnostics Dashboard"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <ShieldCheck
              className="w-5 h-5 text-emerald-400"
              aria-hidden="true"
            />
            BFT Consensus Diagnostics
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            Real-time Byzantine Fault Tolerant protocol telemetry, proposal
            transaction hashes, and sequence tracking.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshState}
          aria-label="Refresh consensus diagnostics"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Metric Cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <p className="text-xs font-medium text-zinc-400">Current View</p>
          <p className="mt-1 text-2xl font-bold text-white">{currentView}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-zinc-400">Sequence Number</p>
            {currentSequence > 0 && (
              <CopyButton
                value={currentSequence}
                label="sequence number"
                testId="copy-current-sequence-btn"
              />
            )}
          </div>
          <p className="mt-1 text-2xl font-bold text-white">
            {currentSequence}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <p className="text-xs font-medium text-zinc-400">Current Leader</p>
          <p
            className="mt-1 text-sm font-semibold text-emerald-400 truncate"
            title={currentLeader || "None"}
          >
            {currentLeader || "None"}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
          <p className="text-xs font-medium text-zinc-400">
            Quorum Requirement
          </p>
          <p className="mt-1 text-sm font-semibold text-zinc-200">
            {quorumSize} of {validators.length} nodes (2F + 1)
          </p>
        </div>
      </div>

      {/* Latest Commit QC Parent Details */}
      {lastCommitQC && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h3 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Activity className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            Last Committed Quorum Certificate
          </h3>
          <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <span className="text-zinc-500">Block Hash:</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-300 break-all">
                  {lastCommitQC.blockHash}
                </code>
                <CopyButton
                  value={lastCommitQC.blockHash}
                  label="proposal transaction hash"
                  testId="copy-last-qc-hash-btn"
                />
              </div>
            </div>
            <div>
              <span className="text-zinc-500">Committed Sequence:</span>
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-300">
                  {lastCommitQC.sequence}
                </code>
                <CopyButton
                  value={lastCommitQC.sequence}
                  label="sequence number"
                  testId="copy-last-qc-seq-btn"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Proposals and Chain Diagnostics Table */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-blue-400" aria-hidden="true" />
          Consensus Proposal Telemetry
        </h3>

        <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
          <table
            className="w-full text-left text-xs"
            data-testid="proposals-table"
          >
            <thead className="border-b border-white/10 bg-white/[0.04] text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Seq
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  View
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Proposal Hash
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Parent Hash
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Proposer
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {proposals.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No proposals or blocks recorded yet.
                  </td>
                </tr>
              ) : (
                proposals.map((item) => (
                  <tr
                    key={`${item.view}-${item.sequence}-${item.blockHash}`}
                    className="hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-white">
                      <div className="flex items-center gap-1.5">
                        <span>{item.sequence}</span>
                        <CopyButton
                          value={item.sequence}
                          label="sequence number"
                          testId={`copy-seq-${item.sequence}-btn`}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{item.view}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          item.status === "committed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-zinc-300 break-all"
                          title={item.blockHash}
                        >
                          {item.blockHash.slice(0, 10)}...
                          {item.blockHash.slice(-8)}
                        </span>
                        <CopyButton
                          value={item.blockHash}
                          label="proposal transaction hash"
                          tooltipText="Copy proposal transaction hash"
                          testId={`copy-proposal-hash-${item.sequence}-btn`}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-mono text-zinc-400 break-all"
                          title={item.parentHash}
                        >
                          {item.parentHash.slice(0, 8)}...
                          {item.parentHash.slice(-6)}
                        </span>
                        {item.parentHash && (
                          <CopyButton
                            value={item.parentHash}
                            label="parent hash"
                            tooltipText="Copy parent hash"
                            testId={`copy-parent-hash-${item.sequence}-btn`}
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-zinc-400">
                      {item.proposerId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default BFTConsensusDashboard;
