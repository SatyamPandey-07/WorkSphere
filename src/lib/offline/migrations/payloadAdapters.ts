/**
 * src/lib/offline/migrations/payloadAdapters.ts
 *
 * Offline payload compatibility adapters and structural validators (#10169).
 *
 * Design guarantees:
 * - Preserves unknown fields on older/newer records without stripping them.
 * - Preserves IDs, idempotency keys, client nonces, signatures, and vector clocks.
 * - Never converts completed/synced/applied operations back into pending states.
 * - Keeps encrypted booking payloads (`encryptedPayload`, `isEncrypted`) untouched.
 * - Produces sanitized, non-PII diagnostic summaries for malformed records.
 */

export interface AdaptedRecordResult<T = Record<string, unknown>> {
  valid: boolean;
  changed: boolean;
  record: T;
  reason?: string;
}

const TERMINAL_CHECKIN_STATUSES = new Set(["synced", "failed"]);
const TERMINAL_MUTATION_STATUSES = new Set([
  "COMPLETED",
  "APPLIED",
  "DUPLICATE",
  "REJECTED",
  "FAILED",
]);
const TERMINAL_REVIEW_STATUSES = new Set(["CONFLICT", "AUTH_REQUIRED", "FAILED"]);

/**
 * Produces a non-sensitive deterministic key identifier for structured logs.
 */
export function sanitizeRecordKeyForLog(key: unknown): string {
  if (key === null || key === undefined) return "missing_key";
  const raw = String(key);
  if (raw.length <= 8) return `k_${raw.length}c`;
  return `${raw.slice(0, 4)}...(${raw.length}c)`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adapts a stored booking draft record from `WorkSphereBookingDB/booking_drafts`.
 * Preserves encrypted payloads, vector clocks, field clocks, and unknown fields.
 */
export function adaptBookingDraftRecord(
  raw: unknown,
): AdaptedRecordResult<Record<string, unknown>> {
  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      changed: false,
      record: {},
      reason: "Booking draft record is not a plain object",
    };
  }

  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Booking draft missing string primary key 'id'",
    };
  }

  // If encrypted, validate structural envelope without decrypting or altering ciphertext.
  if (raw.isEncrypted) {
    if (!isPlainRecord(raw.encryptedPayload)) {
      return {
        valid: false,
        changed: false,
        record: raw,
        reason: "Encrypted booking draft missing encryptedPayload object",
      };
    }
    const enc = raw.encryptedPayload;
    if (
      typeof enc.ciphertext !== "string" ||
      typeof enc.iv !== "string" ||
      typeof enc.salt !== "string"
    ) {
      return {
        valid: false,
        changed: false,
        record: raw,
        reason: "Encrypted booking draft has malformed ciphertext envelope",
      };
    }
  }

  let changed = false;
  const adapted: Record<string, unknown> = { ...raw };

  if (typeof adapted.timestamp !== "number" || !Number.isFinite(adapted.timestamp)) {
    adapted.timestamp =
      typeof adapted.updatedAt === "number" && Number.isFinite(adapted.updatedAt)
        ? adapted.updatedAt
        : Date.now();
    changed = true;
  }

  if (!isPlainRecord(adapted.vectorClock)) {
    const node =
      typeof adapted.nodeId === "string" && adapted.nodeId
        ? adapted.nodeId
        : typeof adapted.userId === "string" && adapted.userId
          ? adapted.userId
          : "client";
    const serverVer =
      typeof adapted.serverVersion === "number" && Number.isFinite(adapted.serverVersion)
        ? adapted.serverVersion
        : 0;
    adapted.vectorClock = { [node]: 1, server: serverVer };
    changed = true;
  }

  if (adapted.payload === undefined && !adapted.isEncrypted) {
    adapted.payload = {};
    changed = true;
  }

  return { valid: true, changed, record: adapted };
}

/**
 * Adapts a stored offline check-in record from `pendingCheckins` or `checkins-outbox`.
 * Preserves idempotency keys, client nonces, signatures, and never resets synced items.
 */
export function adaptPendingCheckinRecord(
  raw: unknown,
): AdaptedRecordResult<Record<string, unknown>> {
  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      changed: false,
      record: {},
      reason: "Check-in record is not a plain object",
    };
  }

  const hasId =
    (typeof raw.id === "string" && raw.id.trim() !== "") ||
    (typeof raw.id === "number" && Number.isFinite(raw.id));

  if (!hasId) {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Check-in record missing valid 'id'",
    };
  }

  if (typeof raw.seatId !== "string" && typeof raw.venueId !== "string") {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Check-in record missing both 'seatId' and 'venueId'",
    };
  }

  let changed = false;
  const adapted: Record<string, unknown> = { ...raw };

  if (
    typeof adapted.idempotencyKey !== "string" ||
    adapted.idempotencyKey.trim() === ""
  ) {
    adapted.idempotencyKey = String(adapted.id);
    changed = true;
  }

  // Never downgrade or re-queue terminal statuses
  if (typeof adapted.status !== "string" || adapted.status.trim() === "") {
    adapted.status = "pending";
    changed = true;
  } else if (TERMINAL_CHECKIN_STATUSES.has(adapted.status)) {
    // Explicitly preserve terminal status untouched
  }

  if (typeof adapted.retryCount !== "number" || !Number.isFinite(adapted.retryCount)) {
    adapted.retryCount = 0;
    changed = true;
  }

  return { valid: true, changed, record: adapted };
}

/**
 * Adapts a queued review record from `pendingReviews` or `queued_reviews`.
 * Preserves idempotency key (`id`), version timestamps, conflict state, and unknown fields.
 */
export function adaptPendingReviewRecord(
  raw: unknown,
): AdaptedRecordResult<Record<string, unknown>> {
  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      changed: false,
      record: {},
      reason: "Review record is not a plain object",
    };
  }

  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Review record missing string primary key 'id'",
    };
  }

  if (typeof raw.venueId !== "string" || raw.venueId.trim() === "") {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Review record missing 'venueId'",
    };
  }

  if (!isPlainRecord(raw.data)) {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Review record missing 'data' payload object",
    };
  }

  let changed = false;
  const adapted: Record<string, unknown> = { ...raw };

  const derivedBaseVersion =
    adapted.baseVersionTimestamp ??
    adapted.baseReviewUpdatedAt ??
    adapted.baseVenueUpdatedAt;

  if (
    derivedBaseVersion !== undefined &&
    adapted.baseVersionTimestamp === undefined
  ) {
    adapted.baseVersionTimestamp = derivedBaseVersion;
    changed = true;
  }

  if (derivedBaseVersion !== undefined && adapted.baseVersion === undefined) {
    adapted.baseVersion = derivedBaseVersion;
    changed = true;
  }

  if (typeof adapted.status !== "string" || adapted.status.trim() === "") {
    adapted.status = "PENDING";
    changed = true;
  } else if (TERMINAL_REVIEW_STATUSES.has(adapted.status)) {
    // Keep terminal/conflict statuses untouched
  }

  if (typeof adapted.retryCount !== "number" || !Number.isFinite(adapted.retryCount)) {
    adapted.retryCount = 0;
    changed = true;
  }

  if (typeof adapted.createdAt !== "number" || !Number.isFinite(adapted.createdAt)) {
    adapted.createdAt = Date.now();
    changed = true;
  }

  return { valid: true, changed, record: adapted };
}

/**
 * Adapts an offline mutation / sync queue record (`offline_mutations`, `pending_sync_queue`).
 * Preserves ID, idempotencyKey, vector clocks, and terminal completion status.
 */
export function adaptOfflineMutationRecord(
  raw: unknown,
): AdaptedRecordResult<Record<string, unknown>> {
  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      changed: false,
      record: {},
      reason: "Offline mutation record is not a plain object",
    };
  }

  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Offline mutation record missing string primary key 'id'",
    };
  }

  let changed = false;
  const adapted: Record<string, unknown> = { ...raw };

  if (
    typeof adapted.idempotencyKey !== "string" ||
    adapted.idempotencyKey.trim() === ""
  ) {
    adapted.idempotencyKey = adapted.id as string;
    changed = true;
  }

  if (typeof adapted.retryCount !== "number" || !Number.isFinite(adapted.retryCount)) {
    adapted.retryCount = 0;
    changed = true;
  }

  if (typeof adapted.timestamp !== "number" || !Number.isFinite(adapted.timestamp)) {
    adapted.timestamp = Date.now();
    changed = true;
  }

  // Only default missing status for offline_mutations-style objects; never alter completed states
  if (typeof adapted.status === "string" && TERMINAL_MUTATION_STATUSES.has(adapted.status)) {
    // Preserved as completed/terminal
  }

  return { valid: true, changed, record: adapted };
}

/**
 * Adapts a stored receipt export record (`receiptExports`).
 */
export function adaptReceiptExportRecord(
  raw: unknown,
): AdaptedRecordResult<Record<string, unknown>> {
  if (!isPlainRecord(raw)) {
    return {
      valid: false,
      changed: false,
      record: {},
      reason: "Receipt export record is not a plain object",
    };
  }

  if (typeof raw.bookingId !== "string" || raw.bookingId.trim() === "") {
    return {
      valid: false,
      changed: false,
      record: raw,
      reason: "Receipt export record missing string primary key 'bookingId'",
    };
  }

  let changed = false;
  const adapted: Record<string, unknown> = { ...raw };

  if (typeof adapted.status !== "string" || adapted.status.trim() === "") {
    adapted.status = "pending";
    changed = true;
  }

  if (typeof adapted.createdAt !== "number" || !Number.isFinite(adapted.createdAt)) {
    adapted.createdAt = Date.now();
    changed = true;
  }

  return { valid: true, changed, record: adapted };
}

/**
 * Dispatches to the appropriate compatibility adapter for a given object store.
 */
export function adaptRecordForStore(
  storeName: string,
  raw: unknown,
): AdaptedRecordResult<Record<string, unknown>> {
  switch (storeName) {
    case "booking_drafts":
      return adaptBookingDraftRecord(raw);
    case "pendingCheckins":
    case "checkins-outbox":
      return adaptPendingCheckinRecord(raw);
    case "pendingReviews":
    case "queued_reviews":
      return adaptPendingReviewRecord(raw);
    case "offline_mutations":
    case "pending_sync_queue":
      return adaptOfflineMutationRecord(raw);
    case "receiptExports":
      return adaptReceiptExportRecord(raw);
    default:
      if (!isPlainRecord(raw)) {
        return {
          valid: false,
          changed: false,
          record: {},
          reason: `Record in store '${storeName}' is not a plain object`,
        };
      }
      return { valid: true, changed: false, record: { ...raw } };
  }
}
