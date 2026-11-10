"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  Laptop,
  Smartphone,
  Tablet,
  Key,
  Monitor,
  Shield,
  Clock,
  RefreshCw,
  Download,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Edit3,
  Trash2,
  Lock,
  Mail,
  Check,
} from "lucide-react";
import {
  PasskeyAuditLogEntry,
  SecurityStats,
  PasskeyAuditAction,
} from "@/lib/auth/passkeys/server/auditLog";

const ICON_MAP = {
  laptop: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  key: Key,
  desktop: Monitor,
  shield: Shield,
};

export interface PasskeySecurityAuditLogProps {
  initialFilter?: PasskeyAuditAction | "ALL";
  pollInterval?: number;
  className?: string;
  onLogsLoaded?: (logs: PasskeyAuditLogEntry[]) => void;
}

export function PasskeySecurityAuditLog({
  initialFilter = "ALL",
  pollInterval,
  className = "",
  onLogsLoaded,
}: PasskeySecurityAuditLogProps = {}) {
  const [logs, setLogs] = useState<PasskeyAuditLogEntry[]>([]);
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<PasskeyAuditAction | "ALL">(initialFilter);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchLogs = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) {
        setRefreshing(true);
      }
      setError(null);
      try {
        const url =
          actionFilter === "ALL"
            ? "/api/auth/passkey/audit-log"
            : `/api/auth/passkey/audit-log?action=${actionFilter}`;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch audit log (status ${res.status})`);
        }
        const data = await res.json();
        if (!isMountedRef.current) return;

        if (data.success) {
          const loadedLogs = data.logs || [];
          setLogs(loadedLogs);
          setStats(data.stats || null);
          onLogsLoaded?.(loadedLogs);
        } else {
          throw new Error(data.error || "Failed to load audit logs");
        }
      } catch (err: unknown) {
        if (!isMountedRef.current) return;
        console.error("Failed to fetch passkey security audit log:", err);
        setError(err instanceof Error ? err.message : "Failed to load audit logs");
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [actionFilter, onLogsLoaded],
  );

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!pollInterval || pollInterval <= 0) return;
    const intervalId = setInterval(() => {
      fetchLogs();
    }, pollInterval);
    return () => clearInterval(intervalId);
  }, [pollInterval, fetchLogs]);

  const handleRefresh = () => {
    fetchLogs(true);
  };

  const handleExportJSON = () => {
    if (logs.length === 0) return;
    const dataStr =
      "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `passkey_security_audit_log_${Date.now()}.json`);
    downloadAnchor.setAttribute("data-testid", "audit-export-download-anchor");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getActionBadge = (action: PasskeyAuditAction) => {
    switch (action) {
      case "REGISTER":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
          >
            <Key className="w-3 h-3" />
            Registered
          </span>
        );
      case "AUTHENTICATE":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20"
          >
            <Lock className="w-3 h-3" />
            Sign-In
          </span>
        );
      case "RENAME":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-purple-500/10 text-purple-400 border border-purple-500/20"
          >
            <Edit3 className="w-3 h-3" />
            Nicknamed
          </span>
        );
      case "ROTATE":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20"
          >
            <RotateCcw className="w-3 h-3" />
            Rotated
          </span>
        );
      case "REVOKE":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20"
          >
            <Trash2 className="w-3 h-3" />
            Revoked
          </span>
        );
      case "STEP_UP":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
          >
            <ShieldCheck className="w-3 h-3" />
            Step-Up
          </span>
        );
      case "OTP_REQUEST":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-sky-500/10 text-sky-400 border border-sky-500/20"
          >
            <Mail className="w-3 h-3" />
            OTP Sent
          </span>
        );
      case "OTP_VERIFY":
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-teal-500/10 text-teal-400 border border-teal-500/20"
          >
            <Check className="w-3 h-3" />
            OTP Verified
          </span>
        );
      default:
        return (
          <span
            data-testid={`badge-action-${action}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-zinc-800 text-zinc-300"
          >
            {action}
          </span>
        );
    }
  };

  return (
    <div
      data-testid="passkey-security-audit-log"
      className={`space-y-6 animate-in fade-in duration-300 ${className}`}
    >
      {/* Security Health Summary Bar */}
      {stats && (
        <div data-testid="security-stats-grid" className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div
            data-testid="security-posture-card"
            className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between"
          >
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Security Posture
              </div>
              <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                {stats.overallSecurityHealth === "EXCELLENT" ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span data-testid="health-value-excellent" className="text-emerald-400">
                      Excellent
                    </span>
                  </>
                ) : stats.overallSecurityHealth === "GOOD" ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span data-testid="health-value-good" className="text-blue-400">
                      Protected
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span data-testid="health-value-attention" className="text-amber-400">
                      Needs Review
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div
            data-testid="passkey-logins-card"
            className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between"
          >
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Passkey Logins
              </div>
              <div data-testid="stats-successful-logins" className="text-lg font-black text-white mt-0.5">
                {stats.successfulLogins}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <Lock className="w-5 h-5" />
            </div>
          </div>

          <div
            data-testid="failed-attempts-card"
            className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between"
          >
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Failed Attempts
              </div>
              <div data-testid="stats-failed-attempts" className="text-lg font-black text-white mt-0.5">
                {stats.failedAttempts}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400">
              <XCircle className="w-5 h-5" />
            </div>
          </div>

          <div
            data-testid="total-events-card"
            className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800/80 flex items-center justify-between"
          >
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                Total Audit Events
              </div>
              <div data-testid="stats-total-events" className="text-lg font-black text-white mt-0.5">
                {stats.totalEvents}
              </div>
            </div>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <Clock className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Error alert banner */}
      {error && (
        <div
          role="alert"
          data-testid="audit-error-banner"
          className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            data-testid="audit-error-retry-btn"
            onClick={() => fetchLogs()}
            className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-bold transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Control / Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div
          role="group"
          aria-label="Filter audit logs by action"
          className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0"
        >
          <span className="text-xs font-bold text-zinc-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {[
            { id: "ALL", label: "All Events" },
            { id: "REGISTER", label: "Registered" },
            { id: "AUTHENTICATE", label: "Logins" },
            { id: "RENAME", label: "Nicknames" },
            { id: "ROTATE", label: "Rotations" },
            { id: "REVOKE", label: "Revoked" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              data-testid={`audit-filter-${tab.id}`}
              onClick={() => setActionFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                actionFilter === tab.id
                  ? "bg-blue-600 text-white shadow-md shadow-blue-900/30"
                  : "bg-zinc-800/60 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 border border-zinc-700/40"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <button
            type="button"
            data-testid="audit-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            aria-label="Refresh logs"
            title="Refresh logs"
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 hover:text-white transition-colors border border-zinc-700/60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-blue-400" : ""}`} />
          </button>
          <button
            type="button"
            data-testid="audit-export-btn"
            onClick={handleExportJSON}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 font-bold text-xs border border-zinc-700/60 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Log Feed */}
      {loading ? (
        <div
          role="status"
          data-testid="audit-loading-state"
          className="flex items-center justify-center py-12 text-zinc-500 gap-2"
        >
          <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
          <span className="text-xs">Loading passkey security audit logs...</span>
        </div>
      ) : logs.length === 0 ? (
        <div
          data-testid="audit-empty-state"
          className="p-8 rounded-2xl bg-zinc-950/40 border border-dashed border-zinc-800 text-center space-y-2"
        >
          <Shield className="w-8 h-8 text-zinc-600 mx-auto" />
          <div className="text-sm font-bold text-zinc-400">No passkey security logs yet</div>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Security events and authentication telemetry for your biometric devices and hardware keys
            will appear here in real time.
          </p>
        </div>
      ) : (
        <div data-testid="audit-logs-list" className="space-y-2.5">
          {logs.map((log) => {
            const IconComp = ICON_MAP[log.iconType] || Shield;
            return (
              <div
                key={log.id}
                data-testid={`audit-log-item-${log.id}`}
                className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <div
                    data-testid={`audit-log-icon-${log.id}`}
                    className="p-2.5 rounded-xl bg-zinc-800 text-zinc-300 shrink-0"
                  >
                    <IconComp className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        data-testid={`audit-log-name-${log.id}`}
                        className="text-xs font-bold text-white"
                      >
                        {log.credentialName}
                      </span>
                      {getActionBadge(log.action)}
                      {log.status === "SUCCESS" ? (
                        <span
                          data-testid={`audit-log-status-${log.id}`}
                          className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold"
                        >
                          <CheckCircle2 className="w-3 h-3" /> OK
                        </span>
                      ) : (
                        <span
                          data-testid={`audit-log-status-${log.id}`}
                          className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-semibold"
                        >
                          <XCircle className="w-3 h-3" /> Failed
                        </span>
                      )}
                    </div>
                    {log.details && (
                      <p
                        data-testid={`audit-log-details-${log.id}`}
                        className="text-[11px] text-zinc-400 mt-0.5"
                      >
                        {log.details}
                      </p>
                    )}
                    <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span data-testid={`audit-log-device-${log.id}`}>
                        Device: {log.deviceSummary}
                      </span>
                      <span>•</span>
                      <span data-testid={`audit-log-ip-${log.id}`}>IP: {log.ipAddress}</span>
                    </div>
                  </div>
                </div>

                <div
                  data-testid={`audit-log-time-${log.id}`}
                  className="text-[11px] text-zinc-500 shrink-0 self-end sm:self-auto flex items-center gap-1"
                >
                  <Clock className="w-3 h-3" />
                  {new Date(log.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PasskeySecurityAuditLog;
