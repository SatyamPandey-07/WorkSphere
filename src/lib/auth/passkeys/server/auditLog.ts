/**
 * Passkey Security Audit Log Service
 * 
 * Provides an audit logging system for Passkey lifecycle events, authentication telemetry,
 * device rename/rotations, and threat risk analysis.
 */

import { detectDeviceDetails } from "../deviceDetection";

export type PasskeyAuditAction =
  | "REGISTER"
  | "AUTHENTICATE"
  | "RENAME"
  | "ROTATE"
  | "REVOKE"
  | "OTP_REQUEST"
  | "OTP_VERIFY"
  | "STEP_UP";

export type AuditStatus = "SUCCESS" | "FAILURE";
export type RiskLevel = "low" | "medium" | "high";

export interface PasskeyAuditLogEntry {
  id: string;
  userId: string;
  credentialId?: string;
  credentialName: string;
  action: PasskeyAuditAction;
  status: AuditStatus;
  ipAddress: string;
  userAgent: string;
  deviceSummary: string;
  iconType: "laptop" | "phone" | "tablet" | "key" | "desktop" | "shield";
  timestamp: string;
  details?: string;
  riskLevel: RiskLevel;
}

export interface SecurityStats {
  totalEvents: number;
  successfulLogins: number;
  failedAttempts: number;
  lastActive: string | null;
  overallSecurityHealth: "EXCELLENT" | "GOOD" | "ATTENTION_REQUIRED";
  recentRiskAlerts: number;
}

// In-memory persistent audit buffer per user
const auditLogsStore = new Map<string, PasskeyAuditLogEntry[]>();

export class PasskeyAuditLogService {
  /**
   * Records a new passkey security audit event.
   */
  public log(entry: {
    userId: string;
    credentialId?: string;
    credentialName?: string;
    action: PasskeyAuditAction;
    status: AuditStatus;
    ipAddress?: string;
    userAgent?: string;
    details?: string;
    riskLevel?: RiskLevel;
  }): PasskeyAuditLogEntry {
    const ip = entry.ipAddress || "127.0.0.1";
    const ua = entry.userAgent || "WorkSphere Web Client";
    const detected = detectDeviceDetails(ua);

    const logEntry: PasskeyAuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: entry.userId,
      credentialId: entry.credentialId,
      credentialName: entry.credentialName || detected.suggestedNickname,
      action: entry.action,
      status: entry.status,
      ipAddress: ip,
      userAgent: ua,
      deviceSummary: `${detected.platform} (${detected.browser})`,
      iconType: detected.iconType,
      timestamp: new Date().toISOString(),
      details: entry.details,
      riskLevel: entry.riskLevel || (entry.status === "FAILURE" ? "medium" : "low"),
    };

    const userLogs = auditLogsStore.get(entry.userId) || [];
    userLogs.unshift(logEntry);

    // Keep up to 200 recent events per user
    if (userLogs.length > 200) {
      userLogs.length = 200;
    }

    auditLogsStore.set(entry.userId, userLogs);
    return logEntry;
  }

  /**
   * Retrieves user's passkey audit history and calculated security stats.
   */
  public getUserLogs(
    userId: string,
    options: {
      action?: PasskeyAuditAction;
      status?: AuditStatus;
      limit?: number;
      offset?: number;
    } = {},
  ): {
    logs: PasskeyAuditLogEntry[];
    total: number;
    stats: SecurityStats;
  } {
    let logs = auditLogsStore.get(userId) || [];

    // Filter by action if specified
    if (options.action) {
      logs = logs.filter((l) => l.action === options.action);
    }

    // Filter by status if specified
    if (options.status) {
      logs = logs.filter((l) => l.status === options.status);
    }

    const total = logs.length;
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    const paginated = logs.slice(offset, offset + limit);

    // Compute stats
    const allUserLogs = auditLogsStore.get(userId) || [];
    const successfulLogins = allUserLogs.filter(
      (l) => l.action === "AUTHENTICATE" && l.status === "SUCCESS",
    ).length;
    const failedAttempts = allUserLogs.filter((l) => l.status === "FAILURE").length;
    const recentRiskAlerts = allUserLogs.filter(
      (l) => l.riskLevel === "high" || l.riskLevel === "medium",
    ).length;

    let overallSecurityHealth: SecurityStats["overallSecurityHealth"] = "EXCELLENT";
    if (failedAttempts > 5 || recentRiskAlerts > 3) {
      overallSecurityHealth = "ATTENTION_REQUIRED";
    } else if (failedAttempts > 0) {
      overallSecurityHealth = "GOOD";
    }

    const stats: SecurityStats = {
      totalEvents: allUserLogs.length,
      successfulLogins,
      failedAttempts,
      lastActive: allUserLogs[0]?.timestamp || null,
      overallSecurityHealth,
      recentRiskAlerts,
    };

    return {
      logs: paginated,
      total,
      stats,
    };
  }
}

export const passkeyAuditLogService = new PasskeyAuditLogService();
