/**
 * PostgreSQL Logical Replication CDC Streamer
 *
 * Streams committed write-ahead-log (WAL) changes for venue availability tables
 * into the Redis Stream `stream:db:changes`.
 *
 * Why this exists
 * ---------------
 * Polling PostgreSQL for venue availability changes costs a query per polling
 * interval and still adds up to one full polling interval (often seconds) of
 * latency. This worker tails PostgreSQL's logical replication stream instead,
 * so a committed mutation is transformed and appended to Redis in a single
 * round trip. The expected WAL -> Redis latency is well below 15 ms when Redis
 * is co-located with the worker (the docker-compose Redis or a TCP Redis).
 *
 * Reliability properties
 * ----------------------
 * - The replication slot lives in PostgreSQL, so the server remembers the WAL
 *   position across worker restarts.
 * - The last fully processed WAL position is additionally persisted in Redis
 *   (`cdc:replication:lsn:<slot>`) and on disk. A restarted worker never
 *   re-publishes an already completed WAL page.
 * - Every stream entry carries a deterministic event id derived from the WAL
 *   position (and the index inside the WAL message). A short-lived Redis
 *   idempotency key makes retries after a publish-then-crash window harmless.
 * - Reconnects use capped exponential backoff with jitter. Replication
 *   acknowledgements (standby status updates) are only sent after the stream
 *   append AND the LSN checkpoint have succeeded, so the slot cannot advance
 *   past an event that never reached Redis.
 *
 * Supported logical decoding plugins
 * ----------------------------------
 * - `test_decoding` (default; easiest to enable, text output)
 * - `pgoutput` (native PostgreSQL output plugin; requires a publication)
 *
 * Required PostgreSQL settings: `wal_level = logical` and permission to create
 * replication slots (`REPLICATION` role attribute or superuser).
 */

import { Client as PgClient, type ClientConfig as PgClientConfig } from "pg";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { getRedis } from "../redis";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Redis Stream that receives transformed database change events. */
export const CDC_STREAM_KEY = "stream:db:changes";

/** Default logical replication slot name. */
export const CDC_DEFAULT_SLOT = "worksphere_cdc_slot";

/** Default publication used by the native `pgoutput` plugin. */
export const CDC_DEFAULT_PUBLICATION = "worksphere_cdc_pub";

/** Default logical decoding output plugin. */
export const CDC_DEFAULT_PLUGIN = "test_decoding";

/** Tables whose changes are allowed onto the availability stream. */
export const CDC_TABLES = ["Booking", "DeskLock", "VenueTelemetry"] as const;

/** Alias kept for callers/tests that use the longer name. */
export const CDC_MONITORED_TABLES = CDC_TABLES;

/** Alias kept for callers/tests that use the stream name. */
export const CDC_STREAM = CDC_STREAM_KEY;

/** Redis key prefix for the durable last-processed-LSN checkpoint. */
export const CDC_LSN_KEY_PREFIX = "cdc:replication:lsn";

/** Redis key prefix for the per-event idempotency guard. */
export const CDC_DEDUPE_KEY_PREFIX = "cdc:processed";

/** Default number of seconds an event idempotency key is retained. */
export const CDC_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

export type CdcTable = (typeof CDC_TABLES)[number];

export type CdcOperation = "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface CdcLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

const defaultLogger: CdcLogger = {
  debug: (message, ...args) => console.debug(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};

// ---------------------------------------------------------------------------
// LSN helpers
// ---------------------------------------------------------------------------

const LSN_PATTERN = /^([0-9a-fA-F]+)\/([0-9a-fA-F]+)$/;

/**
 * Parses a PostgreSQL LSN (`16/B374D848`) into a BigInt so it can be compared
 * without losing precision.
 */
export function parseLsn(lsn: string | bigint | number | null | undefined): bigint {
  if (typeof lsn === "bigint") return lsn;
  if (typeof lsn === "number") {
    return Number.isFinite(lsn) ? BigInt(Math.trunc(lsn)) : BigInt(0);
  }

  const value = (lsn ?? "").toString().trim();
  if (!value) return BigInt(0);

  const match = LSN_PATTERN.exec(value);
  if (!match) {
    // PostgreSQL also accepts a decimal byte offset in some contexts.
    if (/^[0-9]+$/.test(value)) return BigInt(value);
    return BigInt(0);
  }

  return (BigInt(`0x${match[1]}`) << BigInt(64)) | BigInt(`0x${match[2]}`);
}

/** Formats a BigInt back into PostgreSQL's `X/Y` LSN representation. */
export function formatLsn(lsn: bigint | string | number): string {
  const value = parseLsn(lsn);
  const high = value >> BigInt(64);
  const low = value & BigInt("0xffffffffffffffff");
  return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase()}`;
}

/** Returns -1, 0 or 1 for a < b, a === b and a > b. */
export function compareLsn(
  a: string | bigint | number | null | undefined,
  b: string | bigint | number | null | undefined,
): number {
  const left = parseLsn(a);
  const right = parseLsn(b);
  return left === right ? 0 : left < right ? -1 : 1;
}

/** True when `candidate` is strictly newer than `checkpoint`. */
export function isLsnNewer(
  candidate: string | bigint | number | null | undefined,
  checkpoint: string | bigint | number | null | undefined,
): boolean {
  return compareLsn(candidate, checkpoint) > 0;
}

/**
 * Returns true when a change at `lsn` has not been checkpointed yet.
 * A missing/zero checkpoint means "process everything".
 */
export function shouldProcessLsn(
  lsn: string | bigint | number | null | undefined,
  checkpoint: string | bigint | number | null | undefined,
): boolean {
  if (!checkpoint) return true;
  return compareLsn(lsn, checkpoint) > 0;
}

// ---------------------------------------------------------------------------
// Decoded change model
// ---------------------------------------------------------------------------

export interface LogicalChange {
  /** PostgreSQL schema, usually `public`. */
  schema: string;
  /** Table name exactly as reported by logical decoding. */
  table: string;
  operation: CdcOperation;
  /** Previous row image (DELETE, or the old key of an UPDATE). */
  old: Record<string, unknown> | null;
  /** New row image (INSERT/UPDATE), null for DELETE/TRUNCATE. */
  new: Record<string, unknown> | null;
  /** Transaction id when the plugin reports one. */
  txId: number | null;
  /** Raw logical-decoding line, useful for debugging/audit. */
  raw?: string;
}

export interface CdcChangeEvent {
  /** Deterministic id: `<slot>:<lsn>:<index>`. */
  id: string;
  eventId: string;
  source: "postgres-cdc";
  slot: string;
  schema: string;
  table: string;
  operation: CdcOperation;
  /** WAL position of the record that produced this change. */
  lsn: string;
  /** Commit LSN when known (native pgoutput reports it in the Begin message). */
  commitLsn: string | null;
  txId: number | null;
  /** ISO-8601 event creation time. */
  timestamp: string;
  /** Epoch milliseconds at which the worker received the WAL data. */
  receivedAt: number;
  /** Epoch milliseconds at which the event was published. */
  publishedAt?: number;
  /** WAL receipt -> Redis append latency in milliseconds. */
  latencyMs: number;
  /** New row image (or old image for DELETE). */
  data: Record<string, unknown> | null;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

export interface CdcTransformContext {
  slot?: string;
  lsn?: string;
  commitLsn?: string | null;
  txId?: number | null;
  /** Position of the change inside the WAL message. */
  index?: number;
  receivedAt?: number;
  timestamp?: string;
  tables?: readonly string[];
  /** `null` disables schema filtering, otherwise defaults to `public`. */
  schema?: string | null;
}

// ---------------------------------------------------------------------------
// test_decoding parser
// ---------------------------------------------------------------------------

const TABLE_LINE_PATTERN =
  /^table\s+(.+?):\s*(INSERT|UPDATE|DELETE|TRUNCATE):\s*([\s\S]*)$/i;

/**
 * `test_decoding` does not escape newlines inside text values, so a value can
 * span several physical lines. Split only where the next line starts a new
 * decoded record instead of splitting on every newline.
 */
const DECODED_RECORD_SPLIT = /\r?\n(?=(?:BEGIN|COMMIT|table)\b)/i;

/**
 * `test_decoding` prints numeric types without quotes (`id[integer]:1`) and
 * everything else as a single-quoted literal (`name[text]:'O''Brien'`, with
 * `''` escaping). The bare-token branch must stay last so quoted literals and
 * `null` are matched first.
 */
const DECODED_COLUMN_PATTERN =
  /([A-Za-z0-9_]+)(?:\[([^\]]*)\])?:(?:'((?:[^']|'')*)'|(null)|([^\s]+))/g;

const INTEGER_TYPES = new Set([
  "smallint",
  "integer",
  "bigint",
  "int",
  "int2",
  "int4",
  "int8",
  "oid",
]);

const FLOAT_TYPES = new Set([
  "real",
  "double precision",
  "float",
  "float4",
  "float8",
  "numeric",
  "decimal",
  "money",
]);

function unescapeDecodedText(value: string): string {
  // test_decoding escapes a single quote by doubling it.
  return value.replace(/''/g, "'");
}

function coerceDecodedValue(raw: string | null, typeName?: string): unknown {
  if (raw === null) return null;
  const type = (typeName ?? "").trim().toLowerCase();
  if (!type) return raw;

  if (type === "boolean" || type === "bool") {
    return raw === "t" || raw === "true" || raw === "1";
  }

  if (INTEGER_TYPES.has(type)) {
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : raw;
  }

  if (FLOAT_TYPES.has(type)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }

  if (type === "json" || type === "jsonb") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  // PostgreSQL array literals (`{a,b}`) and everything else stay as text.
  return raw;
}

/**
 * Extracts `column[type]:'value'` / `column[type]:null` pairs from a
 * test_decoding payload.
 */
export function parseDecodedColumns(
  input: string,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const pattern = new RegExp(DECODED_COLUMN_PATTERN.source, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const column = match[1];
    const typeName = match[2];
    const quotedValue = match[3];
    const isNull = match[4] === "null";
    const bareValue = match[5];
    values[column] = isNull
      ? null
      : coerceDecodedValue(
          unescapeDecodedText(quotedValue ?? bareValue ?? ""),
          typeName,
        );
  }

  return values;
}

/** Splits `public."Booking"` into `{ schema: "public", table: "Booking" }`. */
export function parseQualifiedTable(rawTable: string): {
  schema: string;
  table: string;
} {
  const cleaned = rawTable.replace(/"/g, "").trim();
  const parts = cleaned.split(".").filter(Boolean);
  const table = parts.pop() ?? cleaned;
  const schema = parts.pop() ?? "public";
  return { schema, table };
}

/** Normalizes a table name against the configured allow-list. */
export function canonicalizeTable(
  table: string,
  tables: readonly string[] = CDC_TABLES,
): string | null {
  const normalized = table.replace(/"/g, "").trim().toLowerCase();
  return (
    tables.find((candidate) => candidate.toLowerCase() === normalized) ?? null
  );
}

/**
 * Filters the logical stream down to the venue availability tables.
 * Schema matching is case-insensitive and optional.
 */
export function isMonitoredTable(
  table: string,
  schema: string = "public",
  tables: readonly string[] = CDC_TABLES,
  allowedSchema: string | null = "public",
): boolean {
  if (!canonicalizeTable(table, tables)) return false;
  if (!allowedSchema) return true;
  return schema.toLowerCase() === allowedSchema.toLowerCase();
}

/** Parses a single test_decoding `table ...: INSERT|UPDATE|DELETE` line. */
export function parseTestDecodingLine(line: string): LogicalChange | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const match = TABLE_LINE_PATTERN.exec(trimmed);
  if (!match) return null;

  const qualified = parseQualifiedTable(match[1]);
  const operation = match[2].toUpperCase() as CdcOperation;
  const body = match[3] ?? "";

  let oldValues: Record<string, unknown> | null = null;
  let newValues: Record<string, unknown> | null = null;

  if (operation === "INSERT") {
    newValues = parseDecodedColumns(body);
  } else if (operation === "DELETE") {
    oldValues = parseDecodedColumns(body);
  } else if (operation === "UPDATE") {
    // test_decoding emits: `UPDATE: old-key: <cols> new-tuple: <cols>`
    const oldKeyIndex = body.indexOf("old-key:");
    const newTupleIndex = body.indexOf("new-tuple:");

    if (newTupleIndex >= 0) {
      const oldPart =
        oldKeyIndex >= 0 ? body.slice(oldKeyIndex + "old-key:".length, newTupleIndex) : "";
      oldValues = oldPart.trim() ? parseDecodedColumns(oldPart) : null;
      newValues = parseDecodedColumns(body.slice(newTupleIndex + "new-tuple:".length));
    } else {
      newValues = parseDecodedColumns(body);
    }
  }

  return {
    schema: qualified.schema,
    table: qualified.table,
    operation,
    old: oldValues,
    new: newValues,
    txId: null,
    raw: trimmed,
  };
}

export interface ParsedTestDecodingOutput {
  changes: LogicalChange[];
  begin: { xid: number | null } | null;
  commit: { xid: number | null } | null;
}

/**
 * Parses a complete test_decoding output chunk (BEGIN/table.../COMMIT).
 */
export function parseTestDecodingOutput(raw: string): ParsedTestDecodingOutput {
  const changes: LogicalChange[] = [];
  let begin: { xid: number | null } | null = null;
  let commit: { xid: number | null } | null = null;
  let currentXid: number | null = null;

  const lines = raw.split(DECODED_RECORD_SPLIT);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const beginMatch = /^BEGIN\b(?:\s+(\d+))?/i.exec(trimmed);
    if (beginMatch) {
      currentXid = beginMatch[1] ? Number(beginMatch[1]) : null;
      begin = { xid: currentXid };
      continue;
    }

    const commitMatch = /^COMMIT\b(?:\s+(\d+))?/i.exec(trimmed);
    if (commitMatch) {
      commit = { xid: commitMatch[1] ? Number(commitMatch[1]) : currentXid };
      continue;
    }

    const change = parseTestDecodingLine(trimmed);
    if (change) {
      change.txId = currentXid;
      changes.push(change);
    }
  }

  return { changes, begin, commit };
}

/** Convenience wrapper returning only the row changes. */
export function parseTestDecodingMessage(raw: string): LogicalChange[] {
  return parseTestDecodingOutput(raw).changes;
}

// ---------------------------------------------------------------------------
// pgoutput parser
// ---------------------------------------------------------------------------

const PG_EPOCH_MS = Date.UTC(2000, 0, 1);
const PG_EPOCH_OFFSET_MICROS = BigInt(946684800) * BigInt(1_000_000);

function pgMicrosecondsToIso(microseconds: bigint): string {
  const millis = Number(microseconds / BigInt(1_000)) + PG_EPOCH_MS;
  if (!Number.isFinite(millis)) return new Date().toISOString();
  return new Date(millis).toISOString();
}

function isoToPgMicroseconds(epochMs: number): bigint {
  const micros = BigInt(Math.max(0, Math.trunc(epochMs))) * BigInt(1_000);
  return micros - PG_EPOCH_OFFSET_MICROS;
}

const PG_OID_BOOL = 16;
const PG_OID_INT8 = 20;
const PG_OID_INT2 = 21;
const PG_OID_INT4 = 23;
const PG_OID_FLOAT4 = 700;
const PG_OID_FLOAT8 = 701;
const PG_OID_NUMERIC = 1700;
const PG_OID_JSON = 114;
const PG_OID_JSONB = 3802;

function coercePgOutputValue(value: string, typeOid: number): unknown {
  switch (typeOid) {
    case PG_OID_BOOL:
      return value === "t" || value === "true" || value === "1";
    case PG_OID_INT2:
    case PG_OID_INT4:
    case PG_OID_INT8: {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) ? parsed : value;
    }
    case PG_OID_FLOAT4:
    case PG_OID_FLOAT8:
    case PG_OID_NUMERIC: {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }
    case PG_OID_JSON:
    case PG_OID_JSONB:
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

class PgOutputCursor {
  private offset = 0;
  private readonly buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  uint8(): number {
    if (this.remaining < 1) throw new Error("pgoutput: unexpected end of message");
    return this.buffer.readUInt8(this.offset++);
  }

  int8(): number {
    if (this.remaining < 1) throw new Error("pgoutput: unexpected end of message");
    return this.buffer.readInt8(this.offset++);
  }

  uint16(): number {
    if (this.remaining < 2) throw new Error("pgoutput: unexpected end of message");
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  int16(): number {
    if (this.remaining < 2) throw new Error("pgoutput: unexpected end of message");
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  uint32(): number {
    if (this.remaining < 4) throw new Error("pgoutput: unexpected end of message");
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  int32(): number {
    if (this.remaining < 4) throw new Error("pgoutput: unexpected end of message");
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  uint64(): bigint {
    if (this.remaining < 8) throw new Error("pgoutput: unexpected end of message");
    const value = this.buffer.readBigUInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  int64(): bigint {
    if (this.remaining < 8) throw new Error("pgoutput: unexpected end of message");
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): Buffer {
    if (length < 0 || this.remaining < length) {
      throw new Error("pgoutput: unexpected end of message");
    }
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string(length: number): string {
    return this.bytes(length).toString("utf8");
  }

  cstring(): string {
    const end = this.buffer.indexOf(0, this.offset);
    if (end < 0) throw new Error("pgoutput: unterminated string");
    const value = this.buffer.toString("utf8", this.offset, end);
    this.offset = end + 1;
    return value;
  }
}

export interface PgOutputRelationColumn {
  flags: number;
  name: string;
  typeOid: number;
  typeModifier: number;
}

export interface PgOutputRelation {
  id: number;
  schema: string;
  table: string;
  replicaIdentity: string;
  columns: PgOutputRelationColumn[];
}

export interface PgOutputDecodedMessage {
  type:
    | "begin"
    | "commit"
    | "change"
    | "relation"
    | "truncate"
    | "other";
  changes: LogicalChange[];
  relation?: PgOutputRelation;
  begin?: {
    finalLsn: string;
    commitTime: string;
    xid: number;
  };
  commit?: {
    commitLsn: string;
    endLsn: string;
    commitTime: string;
  };
  relationIds?: number[];
}

/**
 * Stateful decoder for PostgreSQL's native `pgoutput` binary format.
 *
 * Relation messages are cached by relation OID because Insert/Update/Delete
 * messages only carry the OID, not table/column names.
 */
export class PgOutputDecoder {
  private readonly relations = new Map<number, PgOutputRelation>();
  private currentBegin: PgOutputDecodedMessage["begin"] | undefined;

  get relationCount(): number {
    return this.relations.size;
  }

  get currentTransaction(): PgOutputDecodedMessage["begin"] | undefined {
    return this.currentBegin;
  }

  reset(): void {
    this.relations.clear();
    this.currentBegin = undefined;
  }

  parse(buffer: Buffer): PgOutputDecodedMessage | null {
    if (!buffer || buffer.length === 0) return null;

    const cursor = new PgOutputCursor(buffer);
    const messageType = String.fromCharCode(cursor.uint8());

    switch (messageType) {
      case "B": {
        const finalLsn = formatLsn(cursor.uint64());
        const commitTime = pgMicrosecondsToIso(cursor.int64());
        const xid = cursor.int32();
        this.currentBegin = { finalLsn, commitTime, xid };
        return { type: "begin", changes: [], begin: this.currentBegin };
      }

      case "C": {
        cursor.uint8(); // flags
        const commitLsn = formatLsn(cursor.uint64());
        const endLsn = formatLsn(cursor.uint64());
        const commitTime = pgMicrosecondsToIso(cursor.int64());
        this.currentBegin = undefined;
        return {
          type: "commit",
          changes: [],
          commit: { commitLsn, endLsn, commitTime },
        };
      }

      case "R": {
        const relation = this.readRelation(cursor);
        this.relations.set(relation.id, relation);
        return { type: "relation", changes: [], relation };
      }

      case "I": {
        const relationId = cursor.uint32();
        const tupleTag = String.fromCharCode(cursor.uint8());
        if (tupleTag !== "N") {
          return { type: "change", changes: [], relationIds: [relationId] };
        }
        const relation = this.relations.get(relationId);
        if (!relation) {
          return { type: "change", changes: [], relationIds: [relationId] };
        }
        const values = this.readTuple(cursor, relation);
        return {
          type: "change",
          changes: [
            {
              schema: relation.schema,
              table: relation.table,
              operation: "INSERT",
              old: null,
              new: values,
              txId: this.currentBegin?.xid ?? null,
            },
          ],
        };
      }

      case "U": {
        const relationId = cursor.uint32();
        const relation = this.relations.get(relationId);
        if (!relation) {
          return { type: "change", changes: [], relationIds: [relationId] };
        }

        let oldValues: Record<string, unknown> | null = null;
        let nextTag = String.fromCharCode(cursor.uint8());
        if (nextTag === "K" || nextTag === "O") {
          oldValues = this.readTuple(cursor, relation);
          nextTag = String.fromCharCode(cursor.uint8());
        }
        if (nextTag !== "N") {
          return { type: "change", changes: [], relationIds: [relationId] };
        }
        const newValues = this.readTuple(cursor, relation);
        return {
          type: "change",
          changes: [
            {
              schema: relation.schema,
              table: relation.table,
              operation: "UPDATE",
              old: oldValues,
              new: newValues,
              txId: this.currentBegin?.xid ?? null,
            },
          ],
        };
      }

      case "D": {
        const relationId = cursor.uint32();
        const relation = this.relations.get(relationId);
        if (!relation) {
          return { type: "change", changes: [], relationIds: [relationId] };
        }
        const tupleTag = String.fromCharCode(cursor.uint8());
        if (tupleTag !== "K" && tupleTag !== "O") {
          return { type: "change", changes: [], relationIds: [relationId] };
        }
        const oldValues = this.readTuple(cursor, relation);
        return {
          type: "change",
          changes: [
            {
              schema: relation.schema,
              table: relation.table,
              operation: "DELETE",
              old: oldValues,
              new: null,
              txId: this.currentBegin?.xid ?? null,
            },
          ],
        };
      }

      case "T": {
        const relationCount = cursor.uint32();
        cursor.uint8(); // options
        const relationIds: number[] = [];
        const changes: LogicalChange[] = [];
        for (let i = 0; i < relationCount; i += 1) {
          const relationId = cursor.uint32();
          relationIds.push(relationId);
          const relation = this.relations.get(relationId);
          if (relation) {
            changes.push({
              schema: relation.schema,
              table: relation.table,
              operation: "TRUNCATE",
              old: null,
              new: null,
              txId: this.currentBegin?.xid ?? null,
            });
          }
        }
        return { type: "truncate", changes, relationIds };
      }

      // Origin, type and logical message frames do not produce row changes.
      case "O":
      case "Y":
      case "M":
        return { type: "other", changes: [] };

      default:
        return { type: "other", changes: [] };
    }
  }

  private readRelation(cursor: PgOutputCursor): PgOutputRelation {
    const id = cursor.uint32();
    const schema = cursor.cstring();
    const table = cursor.cstring();
    const replicaIdentity = String.fromCharCode(cursor.int8());
    const columnCount = cursor.int16();
    const columns: PgOutputRelationColumn[] = [];

    for (let i = 0; i < columnCount; i += 1) {
      const flags = cursor.uint8();
      const name = cursor.cstring();
      const typeOid = cursor.uint32();
      const typeModifier = cursor.int32();
      columns.push({ flags, name, typeOid, typeModifier });
    }

    return { id, schema, table, replicaIdentity, columns };
  }

  private readTuple(
    cursor: PgOutputCursor,
    relation: PgOutputRelation,
  ): Record<string, unknown> {
    const columnCount = cursor.int16();
    const values: Record<string, unknown> = {};

    for (let i = 0; i < columnCount; i += 1) {
      const column = relation.columns[i];
      const columnName = column?.name ?? `column_${i}`;
      const kind = String.fromCharCode(cursor.uint8());

      if (kind === "n") {
        values[columnName] = null;
        continue;
      }

      if (kind === "u") {
        // Unchanged TOAST value. It is not transmitted across the wire.
        continue;
      }

      if (kind === "t") {
        const length = cursor.uint32();
        const text = cursor.string(length);
        values[columnName] = coercePgOutputValue(text, column?.typeOid ?? 0);
        continue;
      }

      if (kind === "b") {
        const length = cursor.uint32();
        const bytes = cursor.bytes(length);
        values[columnName] = `\\x${bytes.toString("hex")}`;
        continue;
      }

      throw new Error(`pgoutput: unknown tuple column kind '${kind}'`);
    }

    return values;
  }
}

/** Alias for callers that prefer the parser terminology. */
export { PgOutputDecoder as PgOutputParser };

/**
 * One-shot pgoutput parse helper. Pass the same decoder across calls so
 * relation messages are retained.
 */
export function parsePgOutputMessage(
  buffer: Buffer,
  decoder: PgOutputDecoder = new PgOutputDecoder(),
): PgOutputDecodedMessage | null {
  return decoder.parse(buffer);
}

/** Public helper for tests/tools that want to decode either plugin format. */
export function parseLogicalDecodingMessage(
  payload: Buffer | string,
  plugin: string = CDC_DEFAULT_PLUGIN,
  decoder: PgOutputDecoder = new PgOutputDecoder(),
): ParsedTestDecodingOutput | PgOutputDecodedMessage | null {
  if (plugin === "pgoutput") {
    return decoder.parse(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
  }
  return parseTestDecodingOutput(
    Buffer.isBuffer(payload) ? payload.toString("utf8") : payload,
  );
}

// ---------------------------------------------------------------------------
// Change -> event transformation
// ---------------------------------------------------------------------------

function asRecord(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return value && typeof value === "object" ? value : null;
}

/**
 * Transforms a decoded logical change into the JSON shape published to Redis.
 * Returns null for tables outside the availability allow-list.
 */
export function transformCdcChange(
  change: LogicalChange,
  context: CdcTransformContext = {},
): CdcChangeEvent | null {
  const tables = context.tables ?? CDC_TABLES;
  const allowedSchema =
    context.schema === undefined ? "public" : context.schema;

  if (!isMonitoredTable(change.table, change.schema, tables, allowedSchema)) {
    return null;
  }

  const table = canonicalizeTable(change.table, tables);
  if (!table) return null;

  const slot = context.slot ?? CDC_DEFAULT_SLOT;
  const receivedAt = context.receivedAt ?? Date.now();
  const lsn = context.lsn ?? formatLsn(BigInt(0));
  const index = context.index ?? 0;
  const timestamp = context.timestamp ?? new Date(receivedAt).toISOString();
  const newValues = asRecord(change.new);
  const oldValues = asRecord(change.old);
  const id = `${slot}:${lsn}:${index}`;

  return {
    id,
    eventId: id,
    source: "postgres-cdc",
    slot,
    schema: change.schema,
    table,
    operation: change.operation,
    lsn,
    commitLsn: context.commitLsn ?? null,
    txId: change.txId ?? context.txId ?? null,
    timestamp,
    receivedAt,
    latencyMs: Math.max(0, Date.now() - receivedAt),
    data: change.operation === "DELETE" ? oldValues : newValues ?? oldValues,
    new: newValues,
    old: oldValues,
  };
}

/** Alias used by some call sites. */
export const buildCdcEvent = transformCdcChange;

/** Alias used by some call sites. */
export const transformCdcEvent = transformCdcChange;

// ---------------------------------------------------------------------------
// Redis stream publishing
// ---------------------------------------------------------------------------

/**
 * Minimal Redis surface used by the CDC publisher. Both `@upstash/redis`
 * (REST) and the optional `ioredis` adapter below implement this shape.
 */
export interface CdcRedisLike {
  xadd(
    key: string,
    id: string,
    fields: Record<string, string | number>,
    options?: { maxlen?: number; approximate?: boolean },
  ): Promise<unknown>;
  get?(key: string): Promise<unknown>;
  set?(
    key: string,
    value: string,
    options?: { nx?: boolean; ex?: number; px?: number },
  ): Promise<unknown>;
  del?(key: string | string[]): Promise<unknown>;
  connect?(): Promise<unknown>;
  close?(): void;
}

export interface CdcPublisherOptions {
  slot?: string;
  streamKey?: string;
  redis?: CdcRedisLike | null;
  redisProvider?: () => CdcRedisLike | null;
  logger?: CdcLogger;
  dedupeTtlSeconds?: number;
  streamMaxLength?: number;
}

export interface CdcPublishResult {
  published: boolean;
  duplicate?: boolean;
  reason?: "redis_unavailable" | "duplicate" | "error";
  streamId?: string;
  publishedAt?: number;
  latencyMs?: number;
}

/**
 * Builds the Redis Stream entry. `data` contains the complete JSON event while
 * the sibling fields allow consumers to filter without parsing every payload.
 */
export function buildCdcStreamFields(
  event: CdcChangeEvent,
): Record<string, string | number> {
  return {
    id: event.id,
    type: `${event.table}.${event.operation}`,
    table: event.table,
    operation: event.operation,
    lsn: event.lsn,
    commitLsn: event.commitLsn ?? "",
    txId: event.txId ?? "",
    timestamp: event.timestamp,
    latencyMs: event.latencyMs,
    data: JSON.stringify(event),
  };
}

let tcpRedisClient: CdcRedisLike | null | undefined;

function createTcpRedisAdapter(): CdcRedisLike | null {
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_TCP_URL;
  if (!redisUrl) return null;

  try {
    // ioredis is optional; environments using Upstash REST or local simulated
    // timers should continue to work without installing it.
    const packageName = "ioredis";
    const RedisClass = eval("require")(packageName) as any;
    const client = new RedisClass(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
      retryStrategy(times: number) {
        return times > 10 ? null : Math.min(times * 200, 5_000);
      },
    });

    client.on("error", (error: unknown) => {
      defaultLogger.warn("[CDC] TCP Redis connection error:", errorMessage(error));
    });

    const adapter: CdcRedisLike = {
      async connect() {
        if (client.status === "wait" || client.status === "end") {
          await client.connect();
        }
        return client.status;
      },
      async xadd(key, id, fields, options) {
        const flat: string[] = [];
        for (const [field, value] of Object.entries(fields)) {
          flat.push(field, String(value));
        }
        if (options?.maxlen && options.maxlen > 0) {
          if (options.approximate) {
            return client.xadd(
              key,
              id,
              "MAXLEN",
              "~",
              options.maxlen,
              ...flat,
            );
          }
          return client.xadd(key, id, "MAXLEN", options.maxlen, ...flat);
        }
        return client.xadd(key, id, ...flat);
      },
      async get(key) {
        return client.get(key);
      },
      async set(key, value, options) {
        if (options?.nx && options?.ex) {
          return client.set(key, value, "NX", "EX", options.ex);
        }
        if (options?.nx) return client.set(key, value, "NX");
        if (options?.ex) return client.set(key, value, "EX", options.ex);
        return client.set(key, value);
      },
      async del(key) {
        return client.del(key as string);
      },
      close() {
        try {
          client.disconnect();
        } catch {
          // ignore teardown errors
        }
      },
    };

    return adapter;
  } catch {
    return null;
  }
}

/**
 * Resolves the lowest-latency Redis client available.
 *
 * A TCP URL (`REDIS_URL`) is preferred because it avoids an HTTP hop per event.
 * If ioredis is unavailable or no TCP URL is configured, the existing Upstash
 * REST client is used. Tests can inject their own client with `redis`.
 */
export function getCdcRedisClient(): CdcRedisLike | null {
  const preferRest = process.env.CDC_REDIS_TRANSPORT === "rest";
  if (!preferRest && (process.env.REDIS_URL || process.env.REDIS_TCP_URL)) {
    if (tcpRedisClient === undefined) {
      tcpRedisClient = createTcpRedisAdapter();
    }
    if (tcpRedisClient) return tcpRedisClient;
  }

  const configured = getRedis();
  return (configured as unknown as CdcRedisLike | null) ?? null;
}

/** Closes the optional TCP Redis client (used by worker shutdown/tests). */
export function closeCdcRedisClient(): void {
  if (tcpRedisClient) {
    tcpRedisClient.close?.();
    tcpRedisClient = null;
  }
  tcpRedisClient = undefined;
}

/** Backwards-friendly, test-friendly alias. */
export const resetCdcRedis = closeCdcRedisClient;

function isRedisLike(value: unknown): value is CdcRedisLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { xadd?: unknown }).xadd === "function"
  );
}

/**
 * Clients that have already completed (or are completing) `connect()`.
 *
 * The optional TCP adapter uses `lazyConnect`, so both the publisher and the
 * durable checkpoint store must connect before issuing commands. Sharing this
 * set means the connection is established exactly once per client instance.
 */
const connectedRedisClients = new WeakSet<object>();

async function ensureRedisConnected(
  client: CdcRedisLike,
  logger: CdcLogger = defaultLogger,
): Promise<boolean> {
  if (!client.connect) return true;
  if (connectedRedisClients.has(client)) return true;

  try {
    await client.connect();
    connectedRedisClients.add(client);
    return true;
  } catch (error) {
    logger.warn(
      "[CDC] Redis connect failed; the operation will be retried:",
      errorMessage(error),
    );
    return false;
  }
}

export class CdcStreamPublisher {
  private readonly slot: string;
  private readonly streamKey: string;
  private readonly logger: CdcLogger;
  private readonly dedupeTtlSeconds: number;
  private readonly streamMaxLength?: number;
  private readonly explicitRedis?: CdcRedisLike | null;
  private readonly redisProvider?: () => CdcRedisLike | null;

  constructor(options: CdcPublisherOptions = {}) {
    this.slot = options.slot ?? CDC_DEFAULT_SLOT;
    this.streamKey = options.streamKey ?? CDC_STREAM_KEY;
    this.logger = options.logger ?? defaultLogger;
    this.dedupeTtlSeconds =
      options.dedupeTtlSeconds ?? CDC_DEDUPE_TTL_SECONDS;
    this.streamMaxLength =
      options.streamMaxLength && options.streamMaxLength > 0
        ? options.streamMaxLength
        : undefined;
    this.explicitRedis = options.redis;
    this.redisProvider = options.redisProvider;
  }

  private async resolveClient(): Promise<CdcRedisLike | null> {
    const client =
      this.explicitRedis !== undefined
        ? this.explicitRedis
        : this.redisProvider
          ? this.redisProvider()
          : getCdcRedisClient();

    if (!client) return null;

    if (!(await ensureRedisConnected(client, this.logger))) {
      return null;
    }

    return client;
  }

  private dedupeKey(eventId: string): string {
    return `${CDC_DEDUPE_KEY_PREFIX}:${this.slot}:${eventId}`;
  }

  /**
   * Appends one event to `stream:db:changes`.
   *
   * Idempotency uses a small state machine under
   * `cdc:processed:<slot>:<eventId>`:
   *
   * - missing  -> claim it as `pending` with SET NX, then XADD
   * - `done`   -> the event was already appended, skip it
   * - `pending`-> a previous attempt crashed before XADD finished; reclaim the
   *               key and publish again rather than silently dropping the event
   *
   * A crash between XADD and the `done` update can still produce one duplicate,
   * which is the safe failure mode; the persistent LSN checkpoint is the primary
   * restart guard for completed WAL pages.
   */
  async publish(event: CdcChangeEvent): Promise<CdcPublishResult> {
    const client = await this.resolveClient();
    if (!client) {
      return { published: false, reason: "redis_unavailable" };
    }

    const dedupeKey = this.dedupeKey(event.id);
    const dedupeEnabled =
      this.dedupeTtlSeconds > 0 &&
      typeof client.set === "function" &&
      typeof client.get === "function" &&
      typeof client.del === "function";

    let claimed = false;

    if (dedupeEnabled) {
      try {
        const previous = await client.get!(dedupeKey);

        if (previous === "done" || previous === "1") {
          return { published: false, duplicate: true, reason: "duplicate" };
        }

        if (previous === "pending") {
          // Only one CDC consumer may hold a replication slot, so a pending
          // marker means this consumer crashed mid-publish. Reclaim it.
          await client.del!(dedupeKey);
        }

        const result = await client.set!(dedupeKey, "pending", {
          nx: true,
          ex: this.dedupeTtlSeconds,
        });

        if (result === null || result === false || result === 0) {
          return { published: false, duplicate: true, reason: "duplicate" };
        }

        claimed = true;
      } catch (error) {
        // The LSN checkpoint still protects restarts; do not lose the event
        // merely because the optional idempotency key could not be written.
        this.logger.warn(
          "[CDC] Redis idempotency key write failed; publishing anyway:",
          errorMessage(error),
        );
      }
    }

    const fields = buildCdcStreamFields(event);
    const startedAt = Date.now();

    try {
      const streamId = await client.xadd(
        this.streamKey,
        "*",
        fields,
        this.streamMaxLength
          ? { maxlen: this.streamMaxLength, approximate: true }
          : undefined,
      );

      const publishedAt = Date.now();
      event.publishedAt = publishedAt;
      event.latencyMs = Math.max(0, publishedAt - event.receivedAt);

      if (claimed && client.set) {
        try {
          await client.set(dedupeKey, "done", {
            ex: this.dedupeTtlSeconds,
          });
        } catch {
          // Best effort: a retry will see `pending` and republish, which is
          // preferable to losing the event.
        }
      }

      return {
        published: true,
        streamId: streamId == null ? undefined : String(streamId),
        publishedAt,
        latencyMs: event.latencyMs,
      };
    } catch (error) {
      if (claimed && client.del) {
        try {
          await client.del(dedupeKey);
        } catch {
          // Best effort. The checkpoint is not advanced if XADD failed.
        }
      }

      this.logger.error(
        `[CDC] Redis XADD failed after ${Date.now() - startedAt}ms:`,
        errorMessage(error),
      );
      throw error;
    }
  }

  async close(): Promise<void> {
    // Injected clients belong to the caller. The shared TCP adapter is closed
    // explicitly by closeCdcRedisClient during worker shutdown.
  }
}

let defaultPublisher: CdcStreamPublisher | null = null;

export function createCdcPublisher(
  options: CdcPublisherOptions = {},
): CdcStreamPublisher {
  return new CdcStreamPublisher(options);
}

export function getCdcPublisher(): CdcStreamPublisher {
  if (!defaultPublisher) defaultPublisher = new CdcStreamPublisher();
  return defaultPublisher;
}

export function resetCdcPublisher(): void {
  defaultPublisher = null;
}

/**
 * Convenience publisher. The second argument accepts either publisher options
 * or a Redis-like client directly.
 */
export async function publishCdcEvent(
  event: CdcChangeEvent,
  options: CdcPublisherOptions | CdcRedisLike | null = {},
): Promise<CdcPublishResult> {
  const normalized: CdcPublisherOptions = isRedisLike(options)
    ? { redis: options, slot: event.slot }
    : { slot: event.slot, ...(options ?? {}) };

  const publisher =
    normalized.redis !== undefined ||
    normalized.redisProvider !== undefined ||
    normalized.streamKey !== undefined ||
    normalized.dedupeTtlSeconds !== undefined ||
    normalized.streamMaxLength !== undefined
      ? new CdcStreamPublisher(normalized)
      : getCdcPublisher();

  return publisher.publish(event);
}

// ---------------------------------------------------------------------------
// Durable LSN checkpointing
// ---------------------------------------------------------------------------

export interface CdcLsnStore {
  load(slot: string): Promise<string | null>;
  save(slot: string, lsn: string): Promise<void>;
}

export class MemoryLsnStore implements CdcLsnStore {
  private readonly values = new Map<string, string>();

  async load(slot: string): Promise<string | null> {
    return this.values.get(slot) ?? null;
  }

  async save(slot: string, lsn: string): Promise<void> {
    this.values.set(slot, lsn);
  }

  reset(): void {
    this.values.clear();
  }
}

export interface RedisLsnStoreOptions {
  redis?: CdcRedisLike | null;
  redisProvider?: () => CdcRedisLike | null;
  keyPrefix?: string;
}

export class RedisLsnStore implements CdcLsnStore {
  private readonly keyPrefix: string;
  private readonly explicitRedis?: CdcRedisLike | null;
  private readonly redisProvider?: () => CdcRedisLike | null;

  constructor(options: RedisLsnStoreOptions = {}) {
    this.keyPrefix = options.keyPrefix ?? CDC_LSN_KEY_PREFIX;
    this.explicitRedis = options.redis;
    this.redisProvider = options.redisProvider;
  }

  private client(): CdcRedisLike | null {
    if (this.explicitRedis !== undefined) return this.explicitRedis;
    return this.redisProvider ? this.redisProvider() : getCdcRedisClient();
  }

  private key(slot: string): string {
    return `${this.keyPrefix}:${slot}`;
  }

  async load(slot: string): Promise<string | null> {
    const client = this.client();
    if (!client?.get) return null;
    if (!(await ensureRedisConnected(client))) {
      throw new Error("Redis client is not connected");
    }
    const value = await client.get(this.key(slot));
    if (value === null || value === undefined || value === "") return null;
    return typeof value === "string" ? value : String(value);
  }

  async save(slot: string, lsn: string): Promise<void> {
    const client = this.client();
    if (!client?.set) {
      throw new Error("Redis client is not configured");
    }
    if (!(await ensureRedisConnected(client))) {
      throw new Error("Redis client is not connected");
    }
    await client.set(this.key(slot), lsn);
  }
}

export class FileLsnStore implements CdcLsnStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(slot: string): Promise<string | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { slot?: string; lsn?: string } | string;
      if (typeof parsed === "string") return parsed;
      if (parsed && parsed.slot && parsed.slot !== slot) return null;
      return parsed?.lsn ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(slot: string, lsn: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      JSON.stringify({ slot, lsn, updatedAt: new Date().toISOString() }),
      "utf8",
    );
    await rename(temporary, this.filePath);
  }
}

export class CompositeLsnStore implements CdcLsnStore {
  private readonly stores: CdcLsnStore[];

  constructor(stores: CdcLsnStore[]) {
    this.stores = stores;
  }

  async load(slot: string): Promise<string | null> {
    // Checkpoints written by different backends can briefly disagree (for
    // example when a Redis write failed but the file write succeeded). Resume
    // from the newest position so a restart never re-publishes older WAL.
    let newest: string | null = null;

    for (const store of this.stores) {
      try {
        const value = await store.load(slot);
        if (!value) continue;
        if (!newest || compareLsn(value, newest) > 0) {
          newest = value;
        }
      } catch {
        // Try the next backing store.
      }
    }

    return newest;
  }

  async save(slot: string, lsn: string): Promise<void> {
    const results = await Promise.allSettled(
      this.stores.map((store) => store.save(slot, lsn)),
    );

    if (results.every((result) => result.status === "rejected")) {
      const first = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      throw first?.reason instanceof Error
        ? first.reason
        : new Error("Unable to persist CDC LSN checkpoint");
    }
  }
}

function safeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function getDefaultLsnStateFile(slot: string): string {
  return (
    process.env.CDC_LSN_STATE_FILE ||
    join(process.cwd(), ".cdc-state", `${safeFileName(slot)}.lsn.json`)
  );
}

export function createDefaultLsnStore(options: {
  slot: string;
  redis?: CdcRedisLike | null;
  redisProvider?: () => CdcRedisLike | null;
  filePath?: string;
}): CdcLsnStore {
  return new CompositeLsnStore([
    new RedisLsnStore({
      redis: options.redis,
      redisProvider: options.redisProvider,
    }),
    new FileLsnStore(options.filePath ?? getDefaultLsnStateFile(options.slot)),
  ]);
}

// ---------------------------------------------------------------------------
// Reconnection backoff
// ---------------------------------------------------------------------------

export interface BackoffOptions {
  attempt: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
}

/**
 * Capped exponential backoff with +/- jitter.
 *
 * attempt 0 -> ~base, attempt 1 -> ~2x base, attempt 2 -> ~4x base, ...
 */
export function computeReconnectDelay(options: BackoffOptions): number {
  const base = Math.max(1, options.baseDelayMs ?? 500);
  const max = Math.max(base, options.maxDelayMs ?? 30_000);
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0.2));
  const exponent = Math.min(30, Math.max(0, Math.trunc(options.attempt)));
  const exponential = Math.min(max, base * 2 ** exponent);
  const factor = 1 + (Math.random() * 2 - 1) * jitter;
  return Math.max(1, Math.round(exponential * factor));
}

// Alias used by callers that describe the value as a delay.
export const calculateBackoffDelay = computeReconnectDelay;

// ---------------------------------------------------------------------------
// Replication client + streamer
// ---------------------------------------------------------------------------

export interface CdcReplicationConnection {
  on(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  sendCopyFromChunk?(chunk: Buffer): unknown;
}

export interface CdcReplicationClient {
  connect(): Promise<unknown>;
  end(): Promise<unknown> | unknown;
  query(sql: string, values?: unknown[]): Promise<any>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  once?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  connection?: CdcReplicationConnection;
}

export interface CdcStreamerOptions {
  connectionString?: string;
  slot?: string;
  publication?: string;
  plugin?: string;
  streamKey?: string;
  /** Tables to allow. Defaults to Booking, DeskLock and VenueTelemetry. */
  tables?: readonly string[];
  /** Schema to allow. `null` disables the filter. Defaults to `public`. */
  schema?: string | null;
  redis?: CdcRedisLike | null;
  redisProvider?: () => CdcRedisLike | null;
  lsnStore?: CdcLsnStore;
  lsnStateFile?: string;
  clientFactory?: () => CdcReplicationClient;
  logger?: CdcLogger;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  /** 0 means retry forever. */
  maxReconnectAttempts?: number;
  dedupeTtlSeconds?: number;
  streamMaxLength?: number;
  /** Minimum interval between standby status updates. */
  statusUpdateIntervalMs?: number;
  /** Log a warning when WAL -> Redis latency exceeds this value. */
  latencyWarnThresholdMs?: number;
  autoCreateSlot?: boolean;
  autoCreatePublication?: boolean;
}

export interface CdcStreamerStatus {
  running: boolean;
  connected: boolean;
  slot: string;
  plugin: string;
  publication: string;
  streamKey: string;
  tables: readonly string[];
  lastProcessedLsn: string | null;
  publishedEvents: number;
  duplicateEvents: number;
  skippedEvents: number;
  connectionErrors: number;
  reconnectAttempt: number;
  lastPublishedAt: number | null;
  lastError: string | null;
  startedAt: number | null;
}

interface SlotInfo {
  confirmedFlushLsn: string | null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeLsn(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return formatLsn(String(value));
}

export interface StartReplicationCommandOptions {
  slot: string;
  plugin: string;
  publication?: string;
  startLsn?: string;
}

/** Builds a safe `START_REPLICATION` command. Exported for tests/ops tooling. */
export function buildStartReplicationCommand(
  options: StartReplicationCommandOptions,
): string {
  // The replication command grammar expects `RECPTR` (`hex/hex`), not a quoted
  // string, so the LSN must stay unquoted.
  const lsn = formatLsn(options.startLsn ?? "0/0");
  const base = `START_REPLICATION SLOT ${quoteIdentifier(options.slot)} LOGICAL ${lsn}`;

  if (options.plugin !== "pgoutput") return base;

  const publication = options.publication ?? CDC_DEFAULT_PUBLICATION;
  return `${base} ("proto_version" '1', "publication_names" ${quoteLiteral(publication)})`;
}

/** Builds the 34-byte logical replication Standby Status Update frame. */
export function buildStandbyStatusUpdate(
  flushLsn: string | bigint,
  replyRequested = false,
  now = Date.now(),
): Buffer {
  const buffer = Buffer.alloc(34);
  buffer.write("r", 0, "ascii");
  const lsn = parseLsn(flushLsn);
  buffer.writeBigUInt64BE(lsn, 1); // write position
  buffer.writeBigUInt64BE(lsn, 9); // flush position
  buffer.writeBigUInt64BE(lsn, 17); // apply position
  buffer.writeBigInt64BE(isoToPgMicroseconds(now), 25);
  buffer[33] = replyRequested ? 1 : 0;
  return buffer;
}

interface CopyDataHeader {
  walStartLsn: string;
  walEndLsn: string;
  serverTime: string | null;
  payload: Buffer;
}

function parseXLogData(chunk: Buffer): CopyDataHeader | null {
  if (chunk.length < 25 || chunk[0] !== 0x77 /* w */) return null;

  const walStartLsn = formatLsn(chunk.readBigUInt64BE(1));
  const walEndLsn = formatLsn(chunk.readBigUInt64BE(9));
  let serverTime: string | null = null;

  try {
    const micros = chunk.readBigInt64BE(17);
    serverTime = pgMicrosecondsToIso(micros);
  } catch {
    serverTime = null;
  }

  return {
    walStartLsn,
    walEndLsn,
    serverTime,
    payload: chunk.subarray(25),
  };
}

/**
 * Logical replication CDC worker.
 *
 * Typical usage:
 * ```ts
 * const streamer = createCdcStreamer();
 * await streamer.start(); // runs until stop()/SIGTERM
 * ```
 */
export class CdcStreamer {
  private readonly options: CdcStreamerOptions;
  private readonly logger: CdcLogger;
  private readonly slot: string;
  private readonly publication: string;
  private readonly plugin: string;
  private readonly streamKey: string;
  private readonly tables: readonly string[];
  private readonly schema: string | null;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly maxReconnectAttempts: number;
  private readonly statusUpdateIntervalMs: number;
  private readonly latencyWarnThresholdMs: number;
  private readonly autoCreateSlot: boolean;
  private readonly autoCreatePublication: boolean;

  private readonly publisher: CdcStreamPublisher;
  private readonly lsnStore: CdcLsnStore;
  private readonly pgOutput = new PgOutputDecoder();

  private running = false;
  private connected = false;
  private runPromise: Promise<void> | null = null;
  private client: CdcReplicationClient | null = null;
  private processingChain: Promise<void> = Promise.resolve();
  private reconnectAttempt = 0;
  private lastProcessedLsn: string | null = null;
  private lastPersistedLsn: string | null = null;
  private lastAckAt = 0;
  private lastPublishedAt: number | null = null;
  private lastError: string | null = null;
  private startedAt: number | null = null;

  private publishedEvents = 0;
  private duplicateEvents = 0;
  private skippedEvents = 0;
  private connectionErrors = 0;

  constructor(options: CdcStreamerOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? defaultLogger;
    this.slot =
      options.slot ?? process.env.CDC_REPLICATION_SLOT ?? CDC_DEFAULT_SLOT;
    this.publication =
      options.publication ?? process.env.CDC_PUBLICATION ?? CDC_DEFAULT_PUBLICATION;
    this.plugin = options.plugin ?? process.env.CDC_PLUGIN ?? CDC_DEFAULT_PLUGIN;
    this.streamKey =
      options.streamKey ?? process.env.CDC_STREAM_KEY ?? CDC_STREAM_KEY;
    this.tables =
      options.tables ??
      (process.env.CDC_TABLES
        ? process.env.CDC_TABLES.split(",")
            .map((table) => table.trim())
            .filter(Boolean)
        : CDC_TABLES);
    this.schema =
      options.schema === undefined
        ? (process.env.CDC_SCHEMA ?? "public") || null
        : options.schema;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 0;
    this.statusUpdateIntervalMs = options.statusUpdateIntervalMs ?? 250;
    this.latencyWarnThresholdMs = options.latencyWarnThresholdMs ?? 15;
    this.autoCreateSlot = options.autoCreateSlot ?? true;
    this.autoCreatePublication = options.autoCreatePublication ?? true;

    this.publisher = new CdcStreamPublisher({
      slot: this.slot,
      streamKey: this.streamKey,
      redis: options.redis,
      redisProvider: options.redisProvider,
      logger: this.logger,
      dedupeTtlSeconds: options.dedupeTtlSeconds,
      streamMaxLength: options.streamMaxLength,
    });

    this.lsnStore =
      options.lsnStore ??
      createDefaultLsnStore({
        slot: this.slot,
        redis: options.redis,
        redisProvider: options.redisProvider,
        filePath: options.lsnStateFile,
      });
  }

  getStatus(): CdcStreamerStatus {
    return {
      running: this.running,
      connected: this.connected,
      slot: this.slot,
      plugin: this.plugin,
      publication: this.publication,
      streamKey: this.streamKey,
      tables: this.tables,
      lastProcessedLsn: this.lastProcessedLsn,
      publishedEvents: this.publishedEvents,
      duplicateEvents: this.duplicateEvents,
      skippedEvents: this.skippedEvents,
      connectionErrors: this.connectionErrors,
      reconnectAttempt: this.reconnectAttempt,
      lastPublishedAt: this.lastPublishedAt,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  /**
   * Starts the replication loop. The returned promise settles when `stop()` is
   * called or a non-retryable condition is reached.
   */
  start(): Promise<void> {
    if (this.running && this.runPromise) return this.runPromise;

    this.running = true;
    this.startedAt = this.startedAt ?? Date.now();
    this.runPromise = this.runLoop();
    return this.runPromise;
  }

  /** Stops replication, persists the last position and acknowledges the slot. */
  async stop(): Promise<void> {
    this.running = false;

    const client = this.client;
    this.client = null;

    if (client) {
      try {
        await client.end();
      } catch {
        // Connection is already gone.
      }
    }

    if (this.runPromise) {
      const running = this.runPromise;
      await Promise.race([
        running.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }

    if (this.lastProcessedLsn) {
      try {
        await this.lsnStore.save(this.slot, this.lastProcessedLsn);
      } catch (error) {
        this.logger.warn(
          "[CDC] Could not persist final LSN checkpoint:",
          errorMessage(error),
        );
      }
    }

    await this.publisher.close();
    if (this.options.redis === undefined && this.options.redisProvider === undefined) {
      closeCdcRedisClient();
    }
    this.running = false;
    this.connected = false;
    this.runPromise = null;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.connectAndStream();
        if (!this.running) break;
        throw new Error("Replication stream ended unexpectedly");
      } catch (error) {
        if (!this.running) break;

        this.connectionErrors += 1;
        this.lastError = errorMessage(error);
        this.logger.warn(
          `[CDC] Replication error (attempt ${this.reconnectAttempt + 1}):`,
          this.lastError,
        );

        if (
          this.maxReconnectAttempts > 0 &&
          this.reconnectAttempt + 1 >= this.maxReconnectAttempts
        ) {
          this.logger.error(
            "[CDC] Maximum reconnection attempts reached; stopping.",
          );
          break;
        }

        const delay = computeReconnectDelay({
          attempt: this.reconnectAttempt,
          baseDelayMs: this.reconnectBaseDelayMs,
          maxDelayMs: this.reconnectMaxDelayMs,
        });
        this.reconnectAttempt += 1;
        this.logger.info(`[CDC] Reconnecting in ${delay}ms`);
        await sleep(delay);
      }
    }

    this.running = false;
    this.connected = false;
    this.logger.info("[CDC] Replication loop stopped");
  }

  private createClient(): CdcReplicationClient {
    if (this.options.clientFactory) return this.options.clientFactory();

    const connectionString =
      this.options.connectionString ??
      process.env.CDC_DATABASE_URL ??
      process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        "DATABASE_URL (or CDC_DATABASE_URL) is required to start the CDC streamer",
      );
    }

    const config = {
      connectionString,
      application_name: "worksphere-cdc-streamer",
      replication: "database",
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    } as PgClientConfig;

    return new PgClient(config) as unknown as CdcReplicationClient;
  }

  private connectAndStream(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let streamError: Error | null = null;
      let activeClient: CdcReplicationClient | null = null;

      const cleanup = () => {
        const client = activeClient;
        if (!client) {
          this.connected = false;
          return;
        }

        try {
          client.connection?.removeListener?.("copyData", onCopyData);
          client.removeListener?.("error", onError);
          client.removeListener?.("end", onEnd);
        } catch {
          // Listeners may already be gone.
        }

        if (this.client === client) this.client = null;
        this.connected = false;
      };

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();

        if (error) reject(error);
        else resolve();
      };

      const onError = (error: unknown) => {
        streamError = toError(error);
        finish(streamError);
      };

      const onEnd = () => {
        if (this.running && !streamError) {
          streamError = new Error("Replication connection closed unexpectedly");
        }
        finish(streamError ?? undefined);
      };

      const onCopyData = (message: unknown) => {
        const client = activeClient;
        if (!client) return;

        this.processingChain = this.processingChain
          .then(() => this.handleCopyData(message, client))
          .catch((error) => {
            const normalized = toError(error);
            streamError = normalized;
            this.lastError = normalized.message;
            this.logger.error(
              "[CDC] Failed to process WAL message:",
              normalized.message,
            );
            // Terminate the connection so the run loop applies backoff and
            // PostgreSQL re-sends the unacknowledged WAL position.
            try {
              const ending = client.end();
              void Promise.resolve(ending).catch(() => finish(normalized));
            } catch {
              finish(normalized);
            }
          });
      };

      const created = (() => {
        try {
          return this.createClient();
        } catch (error) {
          finish(toError(error));
          return null;
        }
      })();

      if (!created) return;

      const client: CdcReplicationClient = created;
      activeClient = client;
      this.client = client;
      this.processingChain = Promise.resolve();

      client.on("error", onError);
      client.on("end", onEnd);

      void (async () => {
        await client.connect();
        if (settled || !this.running) return;
        this.connected = true;

        const slot = await this.ensureSlot(client);
        if (settled || !this.running) return;

        if (this.plugin === "pgoutput" && this.autoCreatePublication) {
          await this.ensurePublication(client);
          if (settled || !this.running) return;
        }

        const storedLsn = await this.safeLoadCheckpoint();
        const serverLsn = slot.confirmedFlushLsn;

        // Prefer our own checkpoint when it is at least as new as the slot,
        // but never leave the resume position null: an idle worker still has
        // to answer keepalive requests or PostgreSQL drops the connection.
        const resumeLsn =
          compareLsn(storedLsn ?? "0/0", serverLsn ?? "0/0") >= 0
            ? storedLsn ?? serverLsn
            : serverLsn;

        this.lastProcessedLsn = resumeLsn;
        this.lastPersistedLsn = resumeLsn;

        const startLsn = resumeLsn ?? "0/0";

        client.connection?.on("copyData", onCopyData);

        const command = buildStartReplicationCommand({
          slot: this.slot,
          plugin: this.plugin,
          publication: this.publication,
          startLsn,
        });

        this.logger.info(
          `[CDC] Streaming ${this.tables.join(", ")} from slot "${this.slot}" at ${formatLsn(startLsn)}`,
        );

        // START_REPLICATION stays open for the lifetime of the connection. Its
        // promise only settles when replication stops, so it must not be awaited.
        void Promise.resolve(client.query(command)).catch((error) => {
          if (!this.running) {
            finish();
            return;
          }
          streamError = toError(error);
          finish(streamError);
        });
      })().catch((error) => {
        streamError = toError(error);
        finish(streamError);
      });
    });
  }

  private async ensureSlot(client: CdcReplicationClient): Promise<SlotInfo> {
    const existing = await client.query(
      "SELECT slot_name, plugin, confirmed_flush_lsn FROM pg_replication_slots WHERE slot_name = $1",
      [this.slot],
    );

    const row = existing?.rows?.[0];
    if (row) {
      if (row.plugin && row.plugin !== this.plugin) {
        throw new Error(
          `Replication slot "${this.slot}" already exists with plugin "${row.plugin}" but CDC_PLUGIN is "${this.plugin}". ` +
            "Drop/recreate the slot or change CDC_PLUGIN.",
        );
      }
      return { confirmedFlushLsn: normalizeLsn(row.confirmed_flush_lsn) };
    }

    if (!this.autoCreateSlot) {
      throw new Error(
        `Replication slot "${this.slot}" does not exist and autoCreateSlot is disabled`,
      );
    }

    try {
      const created = await client.query(
        "SELECT slot_name, lsn FROM pg_create_logical_replication_slot($1, $2)",
        [this.slot, this.plugin],
      );
      return { confirmedFlushLsn: normalizeLsn(created?.rows?.[0]?.lsn) };
    } catch (error) {
      // Lost a race with another worker. Re-read the slot.
      const code = (error as { code?: string }).code;
      if (code === "42710" || /already exists/i.test(errorMessage(error))) {
        const retry = await client.query(
          "SELECT slot_name, plugin, confirmed_flush_lsn FROM pg_replication_slots WHERE slot_name = $1",
          [this.slot],
        );
        return {
          confirmedFlushLsn: normalizeLsn(retry?.rows?.[0]?.confirmed_flush_lsn),
        };
      }

      throw new Error(
        `Unable to create logical replication slot "${this.slot}" with plugin "${this.plugin}": ${errorMessage(error)}. ` +
          "Ensure wal_level=logical and the role has REPLICATION privileges.",
      );
    }
  }

  private async ensurePublication(client: CdcReplicationClient): Promise<void> {
    const schema = this.schema ?? "public";

    const publication = await client.query(
      "SELECT 1 FROM pg_publication WHERE pubname = $1",
      [this.publication],
    );

    const existingTables = publication?.rows?.length
      ? await client.query(
          "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = $1",
          [this.publication],
        )
      : { rows: [] as Array<{ schemaname: string; tablename: string }> };

    const published = new Set(
      (existingTables?.rows ?? []).map(
        (row: { schemaname: string; tablename: string }) =>
          `${row.schemaname}.${row.tablename}`,
      ),
    );

    const present = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename = ANY($2)",
      [schema, this.tables],
    );

    const tablesToPublish = (present?.rows ?? [])
      .map((row: { tablename: string }) => row.tablename)
      .filter((table: string) => !published.has(`${schema}.${table}`));

    if (tablesToPublish.length === 0) {
      if (!publication?.rows?.length) {
        // An empty publication is valid and can be populated as tables appear.
        await client.query(
          `CREATE PUBLICATION ${quoteIdentifier(this.publication)}`,
        );
      }
      return;
    }

    const tableList = tablesToPublish
      .map((table: string) => `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`)
      .join(", ");

    if (!publication?.rows?.length) {
      await client.query(
        `CREATE PUBLICATION ${quoteIdentifier(this.publication)} FOR TABLE ${tableList}`,
      );
    } else {
      await client.query(
        `ALTER PUBLICATION ${quoteIdentifier(this.publication)} ADD TABLE ${tableList}`,
      );
    }
  }

  private async safeLoadCheckpoint(): Promise<string | null> {
    try {
      return await this.lsnStore.load(this.slot);
    } catch (error) {
      this.logger.warn(
        "[CDC] Could not load persisted LSN checkpoint:",
        errorMessage(error),
      );
      return null;
    }
  }

  private async handleCopyData(
    message: unknown,
    client: CdcReplicationClient,
  ): Promise<void> {
    // A reconnect may have replaced the client while this message was queued
    // behind the processing chain. Never publish or acknowledge on a stale
    // connection.
    if (this.client !== client || !this.running) return;

    const chunk = extractCopyDataBuffer(message);
    if (!chunk || chunk.length === 0) return;

    const messageType = String.fromCharCode(chunk[0]);

    if (messageType === "k") {
      // Primary keepalive: ask us to acknowledge if requested. Only acknowledge
      // a position that is already durable, otherwise a crash could make the
      // server discard WAL we never published.
      if (chunk.length >= 18 && chunk[17] === 1 && this.lastPersistedLsn) {
        this.sendStatusUpdate(client, this.lastPersistedLsn, true);
      }
      return;
    }

    const header = parseXLogData(chunk);
    if (!header) return;

    await this.processWalPayload(header, client);
  }

  private async processWalPayload(
    header: CopyDataHeader,
    client: CdcReplicationClient,
  ): Promise<void> {
    const receivedAt = Date.now();

    // Whole-message duplicate: this WAL page was fully published before the
    // worker restarted. The LSN checkpoint is the end position of the last
    // completed page, so `<=` is correct here.
    if (
      this.lastProcessedLsn &&
      compareLsn(header.walEndLsn, this.lastProcessedLsn) <= 0
    ) {
      this.skippedEvents += 1;
      if (this.lastPersistedLsn) {
        await this.maybeSendStatusUpdate(client, this.lastPersistedLsn);
      }
      return;
    }

    let changes: LogicalChange[] = [];
    let commitLsn: string | null = null;
    let txId: number | null = null;

    if (this.plugin === "pgoutput") {
      const decoded = this.pgOutput.parse(header.payload);
      if (!decoded) return;
      changes = decoded.changes;
      commitLsn = decoded.begin?.finalLsn ?? decoded.commit?.commitLsn ?? null;
      txId = decoded.begin?.xid ?? null;
    } else {
      const decoded = parseTestDecodingOutput(header.payload.toString("utf8"));
      changes = decoded.changes;
      txId = decoded.begin?.xid ?? decoded.commit?.xid ?? null;
    }

    let changeIndex = 0;
    for (const change of changes) {
      const event = transformCdcChange(change, {
        slot: this.slot,
        lsn: header.walStartLsn,
        commitLsn,
        txId,
        index: changeIndex,
        receivedAt,
        timestamp: header.serverTime ?? undefined,
        tables: this.tables,
        schema: this.schema,
      });

      changeIndex += 1;
      if (!event) continue;

      // The persisted checkpoint is the *end* of the last completed WAL page,
      // so only strictly older records are duplicates. Equal LSNs are the
      // first record of the next page and must still be published.
      if (
        this.lastProcessedLsn &&
        compareLsn(event.lsn, this.lastProcessedLsn) < 0
      ) {
        this.skippedEvents += 1;
        continue;
      }

      const result = await this.publisher.publish(event);

      if (result.duplicate) {
        this.duplicateEvents += 1;
        continue;
      }

      if (!result.published) {
        throw new Error(
          `Unable to publish CDC event ${event.id}: ${result.reason ?? "unknown reason"}`,
        );
      }

      this.publishedEvents += 1;
      this.lastPublishedAt = result.publishedAt ?? Date.now();

      if (
        result.latencyMs !== undefined &&
        result.latencyMs > this.latencyWarnThresholdMs
      ) {
        this.logger.warn(
          `[CDC] WAL -> Redis latency ${result.latencyMs}ms exceeded ${this.latencyWarnThresholdMs}ms for ${event.table}.${event.operation}`,
        );
      }
    }

    await this.commitPosition(client, header.walEndLsn);
  }

  private async commitPosition(
    client: CdcReplicationClient,
    walEndLsn: string,
  ): Promise<void> {
    if (compareLsn(walEndLsn, "0/0") <= 0) return;

    // In-memory position advances even if the durable write fails so the
    // current process does not re-publish. The slot is only acknowledged after
    // the checkpoint is durable.
    this.lastProcessedLsn = walEndLsn;

    try {
      await this.lsnStore.save(this.slot, walEndLsn);
      this.lastPersistedLsn = walEndLsn;
      // A successfully processed WAL page means the connection is healthy;
      // reset the backoff only from here (not merely from TCP connect) so a
      // flapping server still backs off progressively.
      this.reconnectAttempt = 0;
    } catch (error) {
      this.logger.warn(
        "[CDC] Could not persist LSN checkpoint; withholding replication acknowledgement:",
        errorMessage(error),
      );
      return;
    }

    await this.maybeSendStatusUpdate(client, walEndLsn);
  }

  private async maybeSendStatusUpdate(
    client: CdcReplicationClient,
    lsn: string,
  ): Promise<void> {
    const now = Date.now();
    if (now - this.lastAckAt < this.statusUpdateIntervalMs) return;
    this.sendStatusUpdate(client, lsn, false);
  }

  private sendStatusUpdate(
    client: CdcReplicationClient,
    lsn: string,
    replyRequested: boolean,
  ): void {
    try {
      const frame = buildStandbyStatusUpdate(lsn, replyRequested);
      client.connection?.sendCopyFromChunk?.(frame);
      this.lastAckAt = Date.now();
    } catch (error) {
      this.logger.warn(
        "[CDC] Could not send standby status update:",
        errorMessage(error),
      );
    }
  }
}

function extractCopyDataBuffer(message: unknown): Buffer | null {
  if (Buffer.isBuffer(message)) return message;

  if (message && typeof message === "object") {
    const candidate =
      (message as { chunk?: unknown }).chunk ??
      (message as { data?: unknown }).data ??
      (message as { buffer?: unknown }).buffer;

    if (Buffer.isBuffer(candidate)) return candidate;
    if (candidate instanceof Uint8Array) return Buffer.from(candidate);
  }

  return null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// ---------------------------------------------------------------------------
// Singleton / factory helpers
// ---------------------------------------------------------------------------

let defaultStreamer: CdcStreamer | null = null;

export function createCdcStreamer(
  options: CdcStreamerOptions = {},
): CdcStreamer {
  return new CdcStreamer(options);
}

export function getCdcStreamer(
  options: CdcStreamerOptions = {},
): CdcStreamer {
  if (!defaultStreamer) defaultStreamer = createCdcStreamer(options);
  return defaultStreamer;
}

export async function startCdcStreamer(
  options: CdcStreamerOptions = {},
): Promise<CdcStreamer> {
  const streamer = getCdcStreamer(options);
  void streamer.start();
  return streamer;
}

export async function stopCdcStreamer(): Promise<void> {
  if (defaultStreamer) {
    await defaultStreamer.stop();
    defaultStreamer = null;
  }
}

export function resetCdcStreamer(): void {
  defaultStreamer = null;
}

/** Test helper: clears singleton state without touching a live connection. */
export function resetCdcStreamerForTests(): void {
  resetCdcStreamer();
  resetCdcPublisher();
  closeCdcRedisClient();
}

export default CdcStreamer;
