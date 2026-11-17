/**
 * Reservation CDC Worker
 *
 * Standalone process that tails PostgreSQL logical replication for the venue
 * availability tables and publishes every committed change to the Redis Stream
 * `stream:db:changes`. See `src/lib/database/cdcStreamer.ts` for the
 * implementation and the reliability guarantees.
 *
 * Run it next to the database and Redis:
 *
 * ```bash
 * npm run cdc:worker
 * # or, with a specific env file:
 * node --experimental-strip-types --env-file=.env.local \
 *   src/workers/reservationCdcWorker.ts
 * ```
 *
 * Environment:
 * - `CDC_DATABASE_URL` / `DATABASE_URL`  PostgreSQL connection string (required)
 * - `CDC_REPLICATION_SLOT`                logical slot name
 * - `CDC_PLUGIN`                          `test_decoding` (default) or `pgoutput`
 * - `CDC_PUBLICATION`                     publication for `pgoutput`
 * - `CDC_SCHEMA`                          schema to watch (default `public`)
 * - `CDC_TABLES`                          comma separated table allow-list
 * - `CDC_STREAM_KEY`                      target Redis Stream key
 * - `CDC_LSN_STATE_FILE`                  override the on-disk LSN checkpoint
 * - `CDC_DEDUPE_TTL_SECONDS`              idempotency key lifetime
 * - `CDC_STREAM_MAX_LENGTH`               approximate stream trim length (0 = off)
 * - `CDC_REDIS_TRANSPORT`                 `rest` to force the Upstash REST client
 * - `REDIS_URL` / `REDIS_TCP_URL`         low-latency TCP Redis (preferred)
 * - `CDC_AUTO_CREATE_SLOT`                create the slot when missing (default true)
 * - `CDC_AUTO_CREATE_PUBLICATION`         create/populate the publication (default true)
 * - `CDC_STATUS_LOG_INTERVAL_MS`          heartbeat interval (0 disables)
 * - `CDC_LOG_LEVEL`                       `debug` | `info` | `warn` | `error`
 */

import {
  CDC_DEDUPE_TTL_SECONDS,
  CDC_DEFAULT_PLUGIN,
  CDC_DEFAULT_PUBLICATION,
  CDC_DEFAULT_SLOT,
  CDC_STREAM_KEY,
  CDC_TABLES,
  createCdcStreamer,
  type CdcLogger,
  type CdcStreamer,
  type CdcStreamerOptions,
  type CdcStreamerStatus,
} from "../lib/database/cdcStreamer";

const WORKER_NAME = "reservation-cdc";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readTables(): readonly string[] {
  const raw = process.env.CDC_TABLES;
  if (!raw) return CDC_TABLES;

  const tables = raw
    .split(",")
    .map((table) => table.trim())
    .filter(Boolean);

  return tables.length > 0 ? tables : CDC_TABLES;
}

/** Builds streamer options from the environment. */
export function getReservationCdcWorkerOptions(
  overrides: CdcStreamerOptions = {},
): CdcStreamerOptions {
  const streamMaxLength = readNumber("CDC_STREAM_MAX_LENGTH", 0);

  return {
    connectionString:
      process.env.CDC_DATABASE_URL ?? process.env.DATABASE_URL ?? undefined,
    slot: process.env.CDC_REPLICATION_SLOT?.trim() || CDC_DEFAULT_SLOT,
    plugin: process.env.CDC_PLUGIN?.trim() || CDC_DEFAULT_PLUGIN,
    publication:
      process.env.CDC_PUBLICATION?.trim() || CDC_DEFAULT_PUBLICATION,
    streamKey: process.env.CDC_STREAM_KEY?.trim() || CDC_STREAM_KEY,
    schema: process.env.CDC_SCHEMA?.trim() || "public",
    tables: readTables(),
    dedupeTtlSeconds: readNumber(
      "CDC_DEDUPE_TTL_SECONDS",
      CDC_DEDUPE_TTL_SECONDS,
    ),
    streamMaxLength: streamMaxLength > 0 ? streamMaxLength : undefined,
    lsnStateFile: process.env.CDC_LSN_STATE_FILE?.trim() || undefined,
    reconnectBaseDelayMs: readNumber("CDC_RECONNECT_BASE_DELAY_MS", 500),
    reconnectMaxDelayMs: readNumber("CDC_RECONNECT_MAX_DELAY_MS", 30_000),
    maxReconnectAttempts: readNumber("CDC_MAX_RECONNECT_ATTEMPTS", 0),
    statusUpdateIntervalMs: readNumber("CDC_STATUS_UPDATE_INTERVAL_MS", 250),
    latencyWarnThresholdMs: readNumber("CDC_LATENCY_WARN_MS", 15),
    autoCreateSlot: readBoolean("CDC_AUTO_CREATE_SLOT", true),
    autoCreatePublication: readBoolean("CDC_AUTO_CREATE_PUBLICATION", true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Minimal level-filtered logger with worker/timestamp prefixes. */
export function createReservationCdcLogger(
  level: LogLevel = (process.env.CDC_LOG_LEVEL as LogLevel) || "info",
): CdcLogger {
  const threshold = LOG_LEVEL_WEIGHT[level] ?? LOG_LEVEL_WEIGHT.info;

  const write = (
    severity: LogLevel,
    sink: (...args: unknown[]) => void,
    message: string,
    ...args: unknown[]
  ) => {
    if (LOG_LEVEL_WEIGHT[severity] < threshold) return;
    sink(`[${WORKER_NAME}] ${new Date().toISOString()} ${message}`, ...args);
  };

  return {
    debug: (message, ...args) =>
      write("debug", console.debug.bind(console), message, ...args),
    info: (message, ...args) =>
      write("info", console.info.bind(console), message, ...args),
    warn: (message, ...args) =>
      write("warn", console.warn.bind(console), message, ...args),
    error: (message, ...args) =>
      write("error", console.error.bind(console), message, ...args),
  };
}

/** Single-line status summary used by the heartbeat log. */
export function formatCdcStatus(status: CdcStreamerStatus): string {
  return [
    `running=${status.running}`,
    `connected=${status.connected}`,
    `slot=${status.slot}`,
    `plugin=${status.plugin}`,
    `lsn=${status.lastProcessedLsn ?? "-"}`,
    `published=${status.publishedEvents}`,
    `duplicates=${status.duplicateEvents}`,
    `skipped=${status.skippedEvents}`,
    `errors=${status.connectionErrors}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

export interface ReservationCdcWorker {
  streamer: CdcStreamer;
  /** Settles when replication stops (shutdown, fatal error or retry limit). */
  done: Promise<void>;
  /** Idempotent graceful shutdown that flushes the LSN checkpoint. */
  stop(): Promise<void>;
}

/**
 * Creates and starts the streamer.
 *
 * The returned `done` promise settles when the replication loop ends, which
 * makes the worker easy to embed from another supervisor process or a test.
 */
export async function startReservationCdcWorker(
  options: CdcStreamerOptions = {},
): Promise<ReservationCdcWorker> {
  const logger =
    options.logger ??
    createReservationCdcLogger(
      (process.env.CDC_LOG_LEVEL as LogLevel) || "info",
    );

  const streamer = createCdcStreamer(
    getReservationCdcWorkerOptions({ ...options, logger }),
  );

  const statusIntervalMs = readNumber("CDC_STATUS_LOG_INTERVAL_MS", 60_000);
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const done = streamer.start();

  if (statusIntervalMs > 0) {
    heartbeat = setInterval(() => {
      logger.info(`[CDC] ${formatCdcStatus(streamer.getStatus())}`);
    }, statusIntervalMs);
    // Heartbeats must never keep the process alive on their own.
    heartbeat.unref?.();
  }

  let stopping: Promise<void> | null = null;

  const stop = async (): Promise<void> => {
    if (stopping) return stopping;

    stopping = (async () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

      logger.info("[CDC] Shutting down replication worker");
      await streamer.stop();

      const status = streamer.getStatus();
      logger.info(
        `[CDC] Stopped (${formatCdcStatus(status)}); last checkpoint ${status.lastProcessedLsn ?? "none"}`,
      );
    })();

    return stopping;
  };

  const status = streamer.getStatus();
  logger.info(
    `[CDC] Starting: slot=${status.slot} plugin=${status.plugin} stream=${status.streamKey} tables=${status.tables.join(",")}`,
  );

  return { streamer, done, stop };
}

/**
 * Runs the worker until a signal arrives or replication gives up.
 * Returns the process exit code.
 */
export async function runReservationCdcWorker(
  options: CdcStreamerOptions = {},
): Promise<number> {
  const logger = options.logger ?? createReservationCdcLogger();
  const worker = await startReservationCdcWorker({ ...options, logger });

  let shuttingDown = false;
  let exitCode = 0;

  const shutdown = (reason: string, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    logger.info(`[CDC] Received ${reason}; stopping`);
    void worker
      .stop()
      .catch((error) => {
        logger.error("[CDC] Shutdown failed:", error);
        exitCode = 1;
      })
      .finally(() => {
        process.exit(exitCode);
      });
  };

  const onSigint = () => shutdown("SIGINT");
  const onSigterm = () => shutdown("SIGTERM");
  const onUncaught = (error: unknown, origin: string) => {
    logger.error(`[CDC] ${origin}:`, error);
    shutdown(origin, 1);
  };

  const onUncaughtException = (error: Error) =>
    onUncaught(error, "uncaughtException");
  const onUnhandledRejection = (reason: unknown) =>
    onUncaught(reason, "unhandledRejection");

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("uncaughtException", onUncaughtException);
  process.on("unhandledRejection", onUnhandledRejection);

  const removeProcessListeners = () => {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.removeListener("uncaughtException", onUncaughtException);
    process.removeListener("unhandledRejection", onUnhandledRejection);
  };

  try {
    await worker.done;
  } catch (error) {
    logger.error("[CDC] Replication loop failed:", error);
    exitCode = 1;
  } finally {
    if (!shuttingDown) {
      if (exitCode === 0) {
        logger.warn("[CDC] Replication loop ended unexpectedly");
        exitCode = 1;
      }
      await worker.stop();
      removeProcessListeners();
    }
  }

  return exitCode;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Detects `node src/workers/reservationCdcWorker.ts` without requiring the
 * module to know whether it was loaded as CommonJS or ESM.
 */
export function isReservationCdcWorkerEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  const normalize = (value: string) =>
    value
      .replace(/\\/g, "/")
      .replace(/\.(?:[cm]?[jt]s)$/i, "")
      .toLowerCase();

  const target = normalize(entry);

  // `typeof` is safe for undeclared identifiers, so this also works when the
  // worker is executed as an ES module.
  const self = typeof __filename === "string" ? normalize(__filename) : null;
  if (self) return self === target;

  return target.endsWith("/reservationcdcworker");
}

/* istanbul ignore next */
if (isReservationCdcWorkerEntryPoint()) {
  void runReservationCdcWorker()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`[${WORKER_NAME}] Fatal error:`, error);
      process.exitCode = 1;
    });
}
