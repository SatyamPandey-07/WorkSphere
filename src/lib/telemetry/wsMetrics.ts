/**
 * Prometheus metrics for the telemetry WebSocket client.
 *
 * A small in-memory registry with a text exporter, so no extra dependency is
 * needed. The registry lives in the process that runs the WebSocket client:
 * `GET /api/metrics/telemetry` exposes the values recorded in that server
 * process.
 */

export const WS_ACTIVE_CONNECTIONS =
  "worksphere_telemetry_ws_active_connections";
export const WS_RECONNECT_ATTEMPTS_TOTAL =
  "worksphere_telemetry_ws_reconnect_attempts_total";
export const WS_CONNECTION_DROPS_TOTAL =
  "worksphere_telemetry_ws_connection_drops_total";
export const WS_BACKOFF_DURATION_SECONDS =
  "worksphere_telemetry_ws_backoff_duration_seconds";

export const PROMETHEUS_CONTENT_TYPE =
  "text/plain; version=0.0.4; charset=utf-8";

/** Upper bounds in seconds. The client caps its backoff at 30 seconds. */
export const BACKOFF_BUCKETS_SECONDS = [0.5, 1, 2, 4, 8, 16, 30] as const;

/** Why a connection ended without the client asking for it. */
export type WsDropReason =
  "connection_lost" | "connect_failed" | "unauthorized";

interface WsMetricsState {
  activeConnections: number;
  reconnectAttempts: Map<string, number>;
  connectionDrops: Map<string, number>;
  backoffBucketCounts: number[];
  backoffSum: number;
  backoffCount: number;
}

function createState(): WsMetricsState {
  return {
    activeConnections: 0,
    reconnectAttempts: new Map(),
    connectionDrops: new Map(),
    backoffBucketCounts: BACKOFF_BUCKETS_SECONDS.map(() => 0),
    backoffSum: 0,
    backoffCount: 0,
  };
}

let state = createState();

function increment(counter: Map<string, number>, label: string): void {
  counter.set(label, (counter.get(label) ?? 0) + 1);
}

export function recordConnectionOpened(): void {
  state.activeConnections += 1;
}

export function recordConnectionClosed(): void {
  state.activeConnections = Math.max(0, state.activeConnections - 1);
}

export function recordConnectionDropped(reason: WsDropReason): void {
  increment(state.connectionDrops, reason);
}

/**
 * Counts one reconnect attempt. `backoffMs` is the delay the client waits
 * before it retries; leave it out when the retry is immediate.
 */
export function recordReconnectAttempt(
  reason: WsDropReason,
  backoffMs?: number,
): void {
  increment(state.reconnectAttempts, reason);
  if (backoffMs === undefined || !Number.isFinite(backoffMs) || backoffMs < 0) {
    return;
  }

  const seconds = backoffMs / 1000;
  state.backoffSum += seconds;
  state.backoffCount += 1;
  const bucket = BACKOFF_BUCKETS_SECONDS.findIndex((bound) => seconds <= bound);
  if (bucket !== -1) {
    state.backoffBucketCounts[bucket] += 1;
  }
}

export function resetWsMetrics(): void {
  state = createState();
}

function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function counterLines(
  name: string,
  help: string,
  counter: Map<string, number>,
): string[] {
  const samples = [...counter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([reason, value]) =>
        `${name}{reason="${escapeLabelValue(reason)}"} ${value}`,
    );
  return [`# HELP ${name} ${help}`, `# TYPE ${name} counter`, ...samples];
}

/** Renders every metric in the Prometheus text exposition format (0.0.4). */
export function renderWsMetrics(): string {
  const lines: string[] = [
    `# HELP ${WS_ACTIVE_CONNECTIONS} Telemetry WebSocket connections currently open.`,
    `# TYPE ${WS_ACTIVE_CONNECTIONS} gauge`,
    `${WS_ACTIVE_CONNECTIONS} ${state.activeConnections}`,
    ...counterLines(
      WS_RECONNECT_ATTEMPTS_TOTAL,
      "Telemetry WebSocket reconnect attempts, by the reason the connection ended.",
      state.reconnectAttempts,
    ),
    ...counterLines(
      WS_CONNECTION_DROPS_TOTAL,
      "Telemetry WebSocket connections that ended without a client request, by reason.",
      state.connectionDrops,
    ),
    `# HELP ${WS_BACKOFF_DURATION_SECONDS} Delay before a telemetry WebSocket reconnect attempt.`,
    `# TYPE ${WS_BACKOFF_DURATION_SECONDS} histogram`,
  ];

  let cumulative = 0;
  BACKOFF_BUCKETS_SECONDS.forEach((bound, index) => {
    cumulative += state.backoffBucketCounts[index];
    lines.push(
      `${WS_BACKOFF_DURATION_SECONDS}_bucket{le="${bound}"} ${cumulative}`,
    );
  });
  lines.push(
    `${WS_BACKOFF_DURATION_SECONDS}_bucket{le="+Inf"} ${state.backoffCount}`,
    `${WS_BACKOFF_DURATION_SECONDS}_sum ${state.backoffSum}`,
    `${WS_BACKOFF_DURATION_SECONDS}_count ${state.backoffCount}`,
  );

  return `${lines.join("\n")}\n`;
}
