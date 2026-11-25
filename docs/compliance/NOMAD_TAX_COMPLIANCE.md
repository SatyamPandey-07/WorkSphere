# Nomad Tax Compliance

Reference for the physical-presence, tax-residency and audit-export logic in
`src/core/tax/NomadTaxManager.ts` and `src/lib/export/domain/taxExporter.ts`.

> **Disclaimer:** WorkSphere produces estimates and an audit trail. It is not
> tax or legal advice. Have a qualified CPA review before filing.

## 1. Day-Count Model

Each tracked calendar day is allocated to **exactly one** jurisdiction.

Let `P(c, d) = 1` if the user was physically present in country `c` on day `d`,
else `0`.

### 1.1 Tax-year presence (183-day rule)

For tax year `Y`:

```
D_c = Σ P(c, d)   for d in [Y-01-01, Y-12-31]
daysRemaining183(c) = max(0, 183 − D_c)
```

Residency is triggered when `D_c ≥ 183`.

### 1.2 Rolling 12-month window (OECD Art. 15)

For any day `d`:

```
W_c(d) = Σ P(c, i)   for i in [d − 364, d]
```

The employment-income exemption requires `W_c(d) ≤ 183`.

### 1.3 Schengen 90/180 rule

Across all Schengen states combined (Regulation (EU) 2016/399, Art. 6(1)):

```
S(d) = Σ P(schengen, i)   for i in [d − 179, d]
daysUsed = S(d)
daysRemaining = max(0, 90 − S(d))
```

`status = "SAFE"` while `S(d) ≤ 90`, otherwise a non-SAFE status. Stays beyond
90 days without a Type D visa count as illegal presence.

## 2. Travel-Day Collision Resolution

When a day touches two countries (departure and arrival):

1. **Destination arrival priority:** the day goes to the arrival jurisdiction.
2. **Invariant:** the sum of days allocated across jurisdictions equals the
   number of unique calendar days tracked.

```
Σ_c D_c = |unique tracked days|
```

This is why the report states "100% Unique Calendar Days".

## 3. Risk Levels

| Level | Meaning | Report label |
|---|---|---|
| `CRITICAL` | `D_c ≥ 183`: statutory tax residency triggered | CRITICAL (RESIDENT) |
| `WARNING` | Approaching the threshold or dual-residency exposure (>90 days in multiple states) | WARNING (HIGH RISK) |
| `SAFE` | Below thresholds | SAFE (NON-RESIDENT) |

The report banner shows the worst status across all jurisdictions.

## 4. Treaty and Double-Taxation Framework

**OECD Model Convention, Art. 4 (tie-breaker).** If two states both treat the
user as resident, residency is assigned in this order:

1. Permanent home available
2. Centre of vital interests (closer personal and economic ties)
3. Habitual abode (greater physical duration)
4. Nationality
5. Mutual Agreement Procedure (MAP)

**Art. 15 (183-day rule).** Employment income earned in a host state is taxable
only in the home state if all of these hold:

- (a) present ≤ 183 days in any 12-month period,
- (b) paid by an employer who is not a resident of the host state,
- (c) not borne by a Permanent Establishment in the host state.

**Double-taxation alerts** are raised when more than one jurisdiction crosses
the dual-residency threshold. Resolve them using the treaty tie-breakers above.

## 5. Audit Export Structures

### 5.1 PDF dossier (2 pages)

| Page | Content |
|---|---|
| 1 | Taxpayer ID, timestamp, certificate ref `WS-TAX-{taxYear}-{HASH8}`, QR + verification hash, 3 metric cards (presence days, Schengen quota, deductible spend and VAT), residency banner, statutory citations |
| 2 | Per-jurisdiction itemization table, collision-resolution notes, CPA attestation block (signature, date/stamp, licence no., firm) |

Table columns: Jurisdiction, Code, Days In-Country, 183-Day Buffer,
Dual-Residency Risk, Expense / VAT. All text is sanitized to ASCII
(`cleanAscii`) so standard PDF fonts render it.

### 5.2 CSV export (RFC 4180)

Produced by `bookingsToCSV` (alias `taxBookingsToCSV`) using `CsvBuilder`.
Line delimiter is `CRLF` (`\r\n`), and fields are escaped per RFC 4180
(quotes, commas and newlines).

| Column | Type | Description |
|---|---|---|
| Confirmation ID | string | `confirmationId`, else `WS-#<id>`, else `WS-#N/A` |
| Venue | string | `venue.name` |
| Category | string | `venue.category` |
| Address | string | `venue.address` or empty |
| Date | string | `YYYY-MM-DD` |
| Time | string | Booking time |
| Billing Code | string | `projectBillingCode` or `N/A` |
| Price ($) | decimal | `(duration_min / 60) × 15`, 2 dp |
| Tax ($) | decimal | `Price × 0.08`, 2 dp |
| Total ($) | decimal | `Price + Tax`, 2 dp |

Missing or invalid `duration` defaults to **60 minutes**.

Sample:

```csv
Confirmation ID,Venue,Category,Address,Date,Time,Billing Code,Price ($),Tax ($),Total ($)
WS-#1042,Hub Berlin,Coworking,"Torstr. 1, Berlin",2026-03-14,09:00,PRJ-77,30.00,2.40,32.40
WS-#1043,Café Lisboa,Cafe,"Rua A 5, Lisbon",2026-03-15,10:30,N/A,15.00,1.20,16.20
```

### 5.3 JSON export

`exportBookingsToJson` returns the `ExportableBooking[]` array pretty-printed
(2-space indent), or `"[]"` for invalid input.

```json
[
  {
    "id": "1042",
    "confirmationId": "WS-#1042",
    "date": "2026-03-14",
    "time": "09:00",
    "duration": 120,
    "projectBillingCode": "PRJ-77",
    "venue": { "name": "Hub Berlin", "category": "Coworking", "address": "Torstr. 1, Berlin" }
  }
]
```

### 5.4 Date ranges

`resolveDateRange({ taxYear })` returns `{ start: "YYYY-01-01", end: "YYYY-12-31" }`
(valid years 1970–9999). Alternatively pass `startDate` and `endDate`
(`start ≤ end`). `filterBookingsByRange` compares the first 10 characters of
`date`, inclusive.

## 6. Precision and Known Limits

- Day counts are integers; money is rounded to 2 dp per line.
- Pricing is an **estimate**: flat $15/hr and 8% tax.
- `computeTaxTotals` treats `duration` as **hours** (default 1), while the CSV
  treats it as **minutes** (default 60). This inconsistency should be reconciled.
- Totals exclude local statutory tax-rate variation and VAT regime differences.