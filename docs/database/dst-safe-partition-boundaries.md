# Database Maintenance Manual: PostgreSQL DateHelper Partition Boundary Normalization & DST Resilience

This maintenance manual documents WorkSphere's PostgreSQL partition boundary generation, UTC normalization algorithms, Daylight Saving Time (DST) drift prevention, and system catalog verification engine ([src/app/api/admin/system/partitions/dateHelper.ts](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/dateHelper.ts) and [src/lib/partitionMaintenance.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/partitionMaintenance.ts)).

---

## Table of Contents

1. [Executive Summary & Architectural Scope](#1-executive-summary--architectural-scope)
2. [UTC Canonical Timestamp Normalization Mechanics](#2-utc-canonical-timestamp-normalization-mechanics)
   - [Calendar Validation & String Parsing](#calendar-validation--string-parsing)
   - [Date.UTC vs Local Date Instantiation](#dateutc-vs-local-date-instantiation)
   - [Zeroing Time Components (`00:00:00.000Z`)](#zeroing-time-components-000000000z)
3. [PostgreSQL Table Partitioning Range Constraints](#3-postgresql-table-partitioning-range-constraints)
   - [Range Syntax (`FOR VALUES FROM ... TO ...`)](#range-syntax-for-values-from--to-)
   - [Half-Open Interval Semantics ($[\text{Start}, \text{End})$)](#half-open-interval-semantics-start-end)
   - [DST Shift Vulnerability Analysis](#dst-shift-vulnerability-analysis)
4. [Automated Partition Pre-Creation & Catalog Verification](#4-automated-partition-pre-creation--catalog-verification)
   - [System Catalog Inspection (`pg_inherits`, `pg_class`, `pg_namespace`)](#system-catalog-inspection-pg_inherits-pg_class-pg_namespace)
   - [Automated Rolling Partition Pre-Creation](#automated-rolling-partition-pre-creation)
   - [Cold Storage Thresholds & Vacuuming](#cold-storage-thresholds--vacuuming)
5. [API Reference & Helper Contracts](#5-api-reference--helper-contracts)
   - [Function Specifications](#function-specifications)
   - [CSV Export Sanitization & Formula Injection Protection](#csv-export-sanitization--formula-injection-protection)
6. [Repository Code Reference Map](#6-repository-code-reference-map)

---

## 1. Executive Summary & Architectural Scope

WorkSphere partitions high-volume time-series PostgreSQL tables—such as `TelemetryRecord`, `PushNotificationLog`, and `AdminAuditLog`—by month using PostgreSQL Range Partitioning. 

Timezone shifts caused by Daylight Saving Time (DST) transitions (such as $\pm 1 \text{ hour}$ clock adjustments in March and November) can introduce dangerous bugs if partition boundaries are computed using local timezone offsets:
- **Boundary Overlaps:** A partition ending at `23:00:00` or starting at `01:00:00` can overlap with neighboring monthly tables, causing DDL errors (`ERROR: partition bound overlaps with existing partition`).
- **Data Insertion Gaps:** Gaps of $1 \text{ hour}$ between partition ranges cause PostgreSQL to reject incoming rows or dump them into unmonitored default partitions.
- **Leap Year & Month-End Irregularities:** Months with 28, 29, 30, or 31 days require dynamic end-of-month calculation.

To guarantee zero database downtime, WorkSphere normalizes all partition boundaries to **UTC Canonical Timestamps** (`00:00:00.000Z`) via [src/app/api/admin/system/partitions/dateHelper.ts](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/dateHelper.ts).

---

## 2. UTC Canonical Timestamp Normalization Mechanics

### Calendar Validation & String Parsing

Partition creation inputs must be strictly validated before constructing SQL statements. Function `validatePartitionDate` enforces strict format checking via regex and calendar verification:

```typescript
export const DATE_STRING_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validatePartitionDate(
  dateStr: string,
  throwOnError = false,
): Date | null {
  if (typeof dateStr !== "string" || !DATE_STRING_REGEX.test(dateStr)) {
    if (throwOnError) {
      throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD format.`);
    }
    return null;
  }

  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    if (throwOnError) {
      throw new Error(`Invalid calendar date: "${dateStr}". Month must be 01-12 and day must be 01-31.`);
    }
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));

  // Verify non-existent dates (e.g. Feb 31 -> Mar 3)
  if (
    isNaN(parsed.getTime()) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    if (throwOnError) {
      throw new Error(`Invalid calendar date: "${dateStr}". Date does not exist on calendar.`);
    }
    return null;
  }

  return parsed;
}
```

---

### Date.UTC vs Local Date Instantiation

Creating dates with `new Date(year, month, day)` uses the host server's local timezone (e.g., `EST`, `CET`, `IST`). During DST transitions, `new Date(2026, 2, 29)` can produce varying UTC offsets.

WorkSphere strictly requires `Date.UTC(...)`:

$$\text{Canonical UTC Timestamp} = \text{Date.UTC}(\text{Year}, \text{MonthIndex}, \text{Day}, 0, 0, 0, 0)$$

```typescript
export function calculatePartitionDates(
  yearOrDate: number | string,
  month?: number,
): { start: Date; end: Date } {
  let y: number;
  let m: number;

  if (typeof yearOrDate === "string") {
    const validDate = parsePartitionDate(yearOrDate);
    y = validDate.getUTCFullYear();
    m = validDate.getUTCMonth();
  } else {
    y = yearOrDate;
    m = month ?? 0;
  }

  // Determine actual last calendar day of the target month (e.g., 28, 29, 30, 31)
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  const startDate = new Date(Date.UTC(y, m, 1));
  const endDate = new Date(Date.UTC(y, m, lastDay + 1));

  return {
    start: startDate,
    end: endDate,
  };
}
```

### Zeroing Time Components (`00:00:00.000Z`)

To ensure PostgreSQL range constraints seamlessly touch without gaps or overlaps:
- **Start Boundary:** First day of the month at `00:00:00.000Z`.
- **End Boundary:** First day of the *next* month at `00:00:00.000Z`.

---

## 3. PostgreSQL Table Partitioning Range Constraints

### Range Syntax (`FOR VALUES FROM ... TO ...`)

When creating monthly range partitions in PostgreSQL, WorkSphere generates DDL using formatted UTC ISO timestamp strings:

```sql
CREATE TABLE "TelemetryRecord_y2026m11" PARTITION OF "TelemetryRecord"
FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
```

### Half-Open Interval Semantics ($[\text{Start}, \text{End})$)

PostgreSQL partition ranges enforce half-open interval semantics:

$$\text{Valid Row Timestamp } t \in [\text{Start}, \text{End}) \iff \text{Start} \le t < \text{End}$$

- `2026-11-01 00:00:00.000+00` is **included** in `TelemetryRecord_y2026m11`.
- `2026-12-01 00:00:00.000+00` is **excluded** from `TelemetryRecord_y2026m11` and **included** in `TelemetryRecord_y2026m12`.

---

### DST Shift Vulnerability Analysis

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   DST SHIFT VULNERABILITY COMPARISON                     │
├───────────────────────────────────┬──────────────────────────────────────┤
│ LOCAL TIMEZONE CALCULATION (BAD)  │ CANONICAL UTC CALCULATION (SAFE)     │
├───────────────────────────────────┼──────────────────────────────────────┤
│ November 1st (DST Fall Back):     │ November 1st:                        │
│ Start: 2026-11-01 00:00:00-04     │ Start: 2026-11-01 00:00:00+00        │
│ End:   2026-12-01 00:00:00-05     │ End:   2026-12-01 00:00:00+00        │
│ Result: 1-hour overlap / gap      │ Result: Continuous 1-month range     │
└───────────────────────────────────┴──────────────────────────────────────┘
```

---

## 4. Automated Partition Pre-Creation & Catalog Verification

File: [src/lib/partitionMaintenance.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/partitionMaintenance.ts#L135-L149)

### System Catalog Inspection (`pg_inherits`, `pg_class`, `pg_namespace`)

Before creating or detaching partitions, WorkSphere queries the PostgreSQL system catalog (`pg_inherits`) to check existing partitions without placing heavy table locks:

```sql
SELECT child.relname AS "name"
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
JOIN pg_namespace parent_ns ON parent.relnamespace = parent_ns.oid
WHERE parent_ns.nspname = 'public'
  AND parent.relname = 'TelemetryRecord'
  AND child.relname ~ '^TelemetryRecord_y[0-9]{4}m(0[1-9]|1[0-2])$'
ORDER BY child.relname;
```

### Automated Rolling Partition Pre-Creation

To prevent row insertion failures when a new month begins, automated cron jobs ([src/lib/partitionMaintenance.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/partitionMaintenance.ts)) pre-create partitions **1 to 3 months in advance**:

```typescript
export async function autoCreateUpcomingTelemetryPartitions(
  now = new Date(),
  monthsAhead = 3,
): Promise<string[]> {
  const created: string[] = [];
  const existing = new Set(await listTelemetryPartitions());

  for (let i = 0; i <= monthsAhead; i++) {
    const targetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const partitionName = getTelemetryPartitionName(targetDate);

    if (!existing.has(partitionName)) {
      const { start, end } = calculatePartitionDates(targetDate.getUTCFullYear(), targetDate.getUTCMonth());
      
      const startIso = start.toISOString();
      const endIso = end.toISOString();

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "${partitionName}"
        PARTITION OF "TelemetryRecord"
        FOR VALUES FROM ('${startIso}') TO ('${endIso}');
      `);

      created.push(partitionName);
    }
  }

  return created;
}
```

### Cold Storage Thresholds & Vacuuming

- **Cold Storage Threshold:** Partitions exceeding `COLD_STORAGE_THRESHOLD_BYTES` ($100 \text{ MB}$) are flagged for archival.
- **Maintenance Operations:** Old partitions outside retention (e.g. $> 12 \text{ months}$) are detached into dedicated archive schemas (`telemetry_archive`) and vacuumed (`VACUUM ANALYZE`).

---

## 5. API Reference & Helper Contracts

File: [src/app/api/admin/system/partitions/dateHelper.ts](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/dateHelper.ts)

### Function Specifications

| Function Signature | Input Parameters | Return Type | Purpose |
| :--- | :--- | :--- | :--- |
| `validatePartitionDate` | `dateStr: string`, `throwOnError?: boolean` | `Date \| null` | Validates YYYY-MM-DD regex & calendar validity. |
| `parsePartitionDate` | `dateStr: string` | `Date` | Parses YYYY-MM-DD string; throws error if invalid. |
| `isValidDateString` | `dateStr: string` | `boolean` | Returns boolean indicating calendar validity. |
| `calculatePartitionDates` | `yearOrDate: number \| string`, `month?: number` | `{ start: Date; end: Date }` | Computes UTC start and end Date boundaries. |
| `parsePartitionBoundaries` | `dateStr: string` | `{ start: Date; end: Date }` | Alias for boundary parsing from string. |
| `escapeCsv` | `value: unknown`, `sanitizeFormulas?: boolean` | `string` | Escapes CSV values and neutralizes formula injection. |

---

### CSV Export Sanitization & Formula Injection Protection

When exporting partition data or audit logs to CSV format via `escapeCsv`, leading spreadsheet formula control characters (`=`, `+`, `-`, `@`, `\t`, `\r`) are sanitized by prepending a single quote (`'`):

```typescript
export function escapeCsv(
  value: string | number | boolean | Date | null | undefined,
  sanitizeFormulas = true,
): string {
  if (value === null || value === undefined) return "";
  
  let str = value instanceof Date ? (isNaN(value.getTime()) ? "" : value.toISOString()) : String(value);

  // Formula injection sanitization
  if (sanitizeFormulas && /^[=+\-@\t\r]/.test(str.trimStart())) {
    str = "'" + str;
  }

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
```

---

## 6. Repository Code Reference Map

- [src/app/api/admin/system/partitions/dateHelper.ts](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/dateHelper.ts) — Boundary normalization utilities, regex validation, UTC date constructors, and CSV escaping.
- [src/lib/partitionMaintenance.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/partitionMaintenance.ts) — PostgreSQL system catalog querying (`pg_inherits`), automated rolling partition pre-creation, and partition detachment.
- [src/app/api/admin/system/partitions/export/route.ts](file:///c:/Users/admin/Desktop/workfere/src/app/api/admin/system/partitions/export/route.ts) — Partition export endpoints consuming date boundary helpers and CSV escaping.
