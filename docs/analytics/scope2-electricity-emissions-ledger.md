# Scope 2 Electricity and Emissions Ledger

This page documents the ledger and CSV audit helpers in
`src/lib/sustainability/scope2Ledger.ts`.

## Emissions calculation and units

Ledger electricity consumption is stored as `kwh` (kilowatt-hours). The
emissions factor is stored per entry as `emissionFactorKgPerKwh`, in kilograms
of CO2-equivalent per kilowatt-hour. When a row does not already contain a
finite `emissionsKgCo2e` value, the CSV exporter calculates:

```text
emissionsKgCo2e = kwh × emissionFactorKgPerKwh
```

The implementation does not define a default emissions factor; callers provide
the factor in each ledger entry. A finite, provided `emissionsKgCo2e` value is
used as-is instead of recalculating it. The calculation and export do not round
the resulting emissions.

## Ledger entry schema

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Ledger entry identifier. |
| `venueId` | `string` | Venue associated with the electricity record. |
| `recordedAt` | `string` | Timestamp used for time-based audit filtering. |
| `kwh` | `number` | Electricity consumption in kilowatt-hours. |
| `emissionFactorKgPerKwh` | `number` | Emissions factor in kg CO2e per kWh. |
| `emissionsKgCo2e` | `number`, optional | Precomputed emissions in kg CO2e. The exporter uses this only when it is a finite number; otherwise it calculates from `kwh` and the factor. |
| `notes` | `string`, optional | Optional note associated with the record. |

Example entry:

```json
{
  "id": "scope2-2026-0042",
  "venueId": "venue-seattle-01",
  "recordedAt": "2026-10-12T09:30:00.000Z",
  "kwh": 125.5,
  "emissionFactorKgPerKwh": 0.32,
  "notes": "October utility meter reading"
}
```

For this example, the exported emissions are `125.5 × 0.32 = 40.16 kg CO2e`.
The factor is example data; the module supplies no universal factor.

## Audit filtering API

`filterScope2LedgerEntries(entries, filter)` returns a new array containing
entries that match the supported filters. `Scope2CsvExportFilter` supports:

| Input | Type | Behavior |
| --- | --- | --- |
| `venueId` | `string`, optional | Trimmed before comparison. A non-empty value matches entries whose `venueId` is exactly equal to it. An omitted or whitespace-only value does not restrict by venue. |
| `from` | `string \| number \| Date`, optional | Inclusive lower timestamp bound. |
| `to` | `string \| number \| Date`, optional | Inclusive upper timestamp bound. |

String bounds are parsed with `Date.parse`; numeric bounds are interpreted as
milliseconds since the Unix epoch; `Date` bounds use their millisecond
timestamp. If a valid time bound is active, entries with an unparseable
`recordedAt` are excluded. Entries before `from` or after `to` are excluded.
There is no separate validation error for an invalid bound: it parses as
absent, so that bound is not applied.

`exportScope2LedgerToCsv(entries, filter)` applies the same filter and returns
a CSV string. Its columns, in order, are:

```text
id, venueId, recordedAt, kwh, emissionFactorKgPerKwh, emissionsKgCo2e, notes
```

Each row's `emissionsKgCo2e` is either the finite supplied value or the
calculated product described above. An omitted note is exported as an empty
value. Rows are separated with CRLF (`\r\n`). The module does not expose a
separate aggregation API or return an aggregate totals object.

## Illustrative aggregation

For a report that totals filtered ledger entries, sum `kwh` for electricity
consumption and sum the calculated or supplied emissions for CO2e. This is
illustrative arithmetic over the entry schema; it is not an output of a
function in `scope2Ledger.ts`.

Given the sample entry above and a second entry with `80 kWh` and an emissions
factor of `0.32 kg CO2e/kWh`:

```json
{
  "entryCount": 2,
  "electricityKwh": 205.5,
  "emissionsKgCo2e": 65.76
}
```

The totals are unrounded sums: `125.5 + 80 = 205.5 kWh`, and
`40.16 + (80 × 0.32) = 65.76 kg CO2e`.

## Defaults and validation notes

- There is no default venue, date range, emission factor, or rounding precision.
- An omitted filter returns all entries from `filterScope2LedgerEntries`.
- Non-finite supplied `emissionsKgCo2e` values fall back to the product of
  `kwh` and `emissionFactorKgPerKwh`.
- Invalid or empty date-filter inputs are treated as absent rather than
  producing a validation error. If a valid date bound is active, an invalid
  entry timestamp does not pass the time filter.
- The module's filter and CSV functions do not validate or reject negative or
  non-finite `kwh` or emission-factor inputs; no such validation behavior is
  defined by this implementation.
