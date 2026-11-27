"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  GatewayCredentialRecord,
  GatewayKeyStatus,
} from "@/lib/telemetry/gatewayAuthRegistry";

export const GATEWAY_TOKEN_PLACEHOLDER = "<GATEWAY_TOKEN>";
export const DEFAULT_COPIED_FEEDBACK_MS = 2_000;

export type SanitizedGatewayRecord = Omit<
  GatewayCredentialRecord,
  "secretOrVerifier"
>;

export interface GatewayCurlSnippetOptions {
  gatewayId: string;
  keyId: string;
  venueId?: string;
  baseUrl?: string;
}

export interface GatewayAuthRegistryPanelProps {
  gateways?: ReadonlyArray<SanitizedGatewayRecord | GatewayCredentialRecord>;
  baseUrl?: string;
  defaultVenueId?: string;
  onCopySnippet?: (
    snippet: string,
    gatewayId: string,
    keyId: string,
  ) => void | Promise<void>;
  copiedFeedbackMs?: number;
  className?: string;
}

function escapeSingleQuotedShellArg(value: string): string {
  return value.replace(/[\r\n\0]/g, "").replace(/'/g, "'\\''");
}

function normalizeBaseUrl(rawBaseUrl?: string): string {
  const candidate = rawBaseUrl?.trim();
  if (candidate && /^https?:\/\//i.test(candidate)) {
    return candidate.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "https://worksphere.app";
}

/**
 * Strips raw credential secrets before any data enters React state or DOM.
 */
export function sanitizeGatewayRecord(
  record: SanitizedGatewayRecord | GatewayCredentialRecord,
): SanitizedGatewayRecord {
  return {
    keyId: record.keyId,
    gatewayId: record.gatewayId,
    scopes: [...record.scopes],
    status: record.status,
    issuedAtMs: record.issuedAtMs,
    expiresAtMs: record.expiresAtMs,
    graceUntilMs: record.graceUntilMs,
    revokedAtMs: record.revokedAtMs,
    revokedReason: record.revokedReason,
    lastUsedAtMs: record.lastUsedAtMs,
    lastUsedAt: record.lastUsedAt,
  };
}

/**
 * Generates a sanitized curl verification command for /api/telemetry/batch.
 * Always uses GATEWAY_TOKEN_PLACEHOLDER and never embeds raw secret tokens.
 */
export function buildSanitizedGatewayCurlSnippet(
  options: GatewayCurlSnippetOptions,
): string {
  const endpoint = `${normalizeBaseUrl(options.baseUrl)}/api/telemetry/batch`;
  const safeGatewayId = escapeSingleQuotedShellArg(options.gatewayId.trim());
  const safeKeyId = escapeSingleQuotedShellArg(options.keyId.trim());
  const safeVenueId = (options.venueId?.trim() || "venue-demo").replace(
    /[\r\n\0"\\]/g,
    "",
  );

  const payload = JSON.stringify({
    readings: [{ venueId: safeVenueId, value: 42 }],
  });

  return [
    `curl -sS -X POST '${escapeSingleQuotedShellArg(endpoint)}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Authorization: Bearer ${GATEWAY_TOKEN_PLACEHOLDER}' \\`,
    `  -H 'x-gateway-id: ${safeGatewayId}' \\`,
    `  -H 'x-gateway-key-id: ${safeKeyId}' \\`,
    `  -d '${escapeSingleQuotedShellArg(payload)}'`,
  ].join("\n");
}

const STATUS_BADGE_CLASSES: Record<GatewayKeyStatus, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  grace: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  retired: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
  revoked: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};

export function GatewayAuthRegistryPanel({
  gateways = [],
  baseUrl,
  defaultVenueId = "venue-demo",
  onCopySnippet,
  copiedFeedbackMs = DEFAULT_COPIED_FEEDBACK_MS,
  className = "",
}: GatewayAuthRegistryPanelProps): React.ReactElement {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sanitizedGateways = useMemo(
    () => gateways.map((record) => sanitizeGatewayRecord(record)),
    [gateways],
  );

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = useCallback(
    async (gateway: SanitizedGatewayRecord, snippet: string) => {
      const rowKey = `${gateway.gatewayId}::${gateway.keyId}`;
      try {
        if (onCopySnippet) {
          await onCopySnippet(snippet, gateway.gatewayId, gateway.keyId);
        } else {
          if (
            typeof navigator === "undefined" ||
            !navigator.clipboard ||
            typeof navigator.clipboard.writeText !== "function"
          ) {
            throw new Error("Clipboard API unavailable");
          }
          await navigator.clipboard.writeText(snippet);
        }

        setFailedKey(null);
        setCopiedKey(rowKey);
        if (resetTimerRef.current !== null) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          setCopiedKey(null);
        }, copiedFeedbackMs);
      } catch {
        setCopiedKey(null);
        setFailedKey(rowKey);
      }
    },
    [copiedFeedbackMs, onCopySnippet],
  );

  return (
    <section
      aria-label="Gateway Auth Registry"
      className={`rounded-3xl border border-white/10 bg-white/[0.04] p-5 ${className}`.trim()}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Gateway Auth Registry
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Verify newly enrolled telemetry gateways using a sanitized{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-zinc-200">
              curl
            </code>{" "}
            command. Replace{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-zinc-200">
              {GATEWAY_TOKEN_PLACEHOLDER}
            </code>{" "}
            with the out-of-band token secret.
          </p>
        </div>
      </div>

      {sanitizedGateways.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
          No telemetry gateways enrolled in this instance.
        </p>
      ) : (
        <div className="space-y-4">
          {sanitizedGateways.map((gateway) => {
            const rowKey = `${gateway.gatewayId}::${gateway.keyId}`;
            const snippet = buildSanitizedGatewayCurlSnippet({
              gatewayId: gateway.gatewayId,
              keyId: gateway.keyId,
              venueId: defaultVenueId,
              baseUrl,
            });
            const isCopied = copiedKey === rowKey;
            const isFailed = failedKey === rowKey;

            return (
              <article
                key={rowKey}
                data-testid={`gateway-card-${gateway.gatewayId}`}
                className="rounded-2xl border border-white/10 bg-black/25 p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-white">
                      {gateway.gatewayId}
                    </span>
                    <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-zinc-300">
                      {gateway.keyId}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[gateway.status]}`}
                    >
                      {gateway.status}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      void handleCopy(gateway, snippet);
                    }}
                    aria-label={
                      isFailed
                        ? `Copy curl verification snippet failed for ${gateway.gatewayId}`
                        : isCopied
                          ? `Copied curl verification snippet for ${gateway.gatewayId}`
                          : `Copy curl verification snippet for ${gateway.gatewayId}`
                    }
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    {isFailed
                      ? "Copy unavailable"
                      : isCopied
                        ? "Copied"
                        : "Copy curl"}
                  </button>
                </div>

                {gateway.scopes.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {gateway.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-zinc-300"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                )}

                <pre
                  data-testid={`gateway-curl-${gateway.gatewayId}`}
                  className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/80 p-3 font-mono text-xs leading-relaxed text-zinc-200"
                >
                  <code>{snippet}</code>
                </pre>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default GatewayAuthRegistryPanel;
