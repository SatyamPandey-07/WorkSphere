# Workspace Folder Exports API Guide

Comprehensive technical documentation for WorkSphere workspace folder export endpoints: geographic export (GeoJSON and KML), PDF summary export, and billing CSV export.

---

## 1. Overview

WorkSphere folders allow users to organize, curate, and share collections of workspaces and venues. The folder export API provides three distinct export mechanisms:

1. **Geographic Export (`GET /api/folders/{id}/export?format=geojson|kml`):** Generates RFC 7946 GeoJSON `FeatureCollection` or OGC KML 2.2 documents containing geographical coordinates, venue metadata, amenities, and WorkSphere venue URLs.
2. **PDF Catalog Summary (`GET /api/folders/{id}/export-pdf`):** Renders a printable PDF collection report containing venue names, addresses, Wi-Fi quality ratings, power outlet availability, and the requesting user's private venue notes.
3. **Billing CSV Export (`GET /api/folders/{id}/export-billing`):** Compiles confirmed booking records across all venues in the folder into a tabular CSV report with duration metrics, billing codes, and heuristic mock expenses.

All endpoints return downloadable file attachments with appropriate MIME types and `Content-Disposition` headers.

---

## 2. Authentication and Folder Authorization

All folder export endpoints require authentication and verify user access before accessing folder data.

### Authentication Requirement

- **Edge Middleware Boundary (`src/middleware.ts`):**
  The path `/api/folders/(.*)` is not in `isPublicRoute`. All unauthenticated requests reaching the application edge are intercepted by Clerk middleware and issued an **HTTP 307 Temporary Redirect** to `/sign-in` with an encoded `redirect_url` parameter.
- **Route Handler Guard:**
  Each handler checks `const { userId } = await auth()`. If `userId` is missing, the route immediately terminates:
  - Geographic export returns **HTTP 401 Unauthorized** with JSON: `{"error": "Unauthorized"}`.
  - PDF export returns **HTTP 401 Unauthorized** with plain text: `"Unauthorized"`.
  - Billing export returns **HTTP 401 Unauthorized** with plain text: `"Unauthorized"`.

### Authorization Logic (`hasFolderAccess`)

Access permissions are resolved via `hasFolderAccess(folderId, userId)` in `src/lib/folders.ts`:

1. **Folder Existence:** If no folder matches `folderId`, the helper returns `{ folder: null, hasAccess: false, role: null }`. Handlers respond with **HTTP 404** (`Folder not found`).
2. **Owner Access:** If `folder.ownerId === userId`, access is granted with role `"OWNER"`.
3. **Member Access:** If the user is listed in `folder.members`, access is granted with their database membership role from the Prisma `FolderRole` enum:
   - `OWNER`
   - `EDITOR`
   - `MEMBER`
4. **Public Folder Access:** If `folder.isPublic === true`, the helper returns `hasAccess: true` with a dynamic role of `"VIEWER"`.
   > [!NOTE]
   > **Prisma Membership Roles vs. Helper Role:**
   > While folder member records in the database persist one of three roles defined by the `FolderRole` Prisma enum (`OWNER`, `EDITOR`, or `MEMBER`), `hasFolderAccess` dynamically assigns the non-persisted role `"VIEWER"` to any authenticated non-member accessing a public folder. Public folders are accessible to any **authenticated** user, but they are not anonymously accessible; unauthenticated requests are intercepted by Clerk middleware before reaching folder lookup.
5. **Forbidden:** If the user is not the owner, not a member, and the folder is private (`isPublic === false`), handlers return **HTTP 403** (`Forbidden`).

---

## 3. Geographic Export API

Exports venues saved within a folder as spatial data for GIS tools, map applications, or Google Earth.

### Endpoint

```http
GET /api/folders/{id}/export?format={format}
```

### Path Parameters

| Parameter | Type     | Required | Description                                   |
| :-------- | :------- | :------- | :-------------------------------------------- |
| `id`      | `string` | Yes      | The unique database identifier of the folder. |

### Query Parameters

| Parameter | Type     | Required | Description                                           |
| :-------- | :------- | :------- | :---------------------------------------------------- |
| `format`  | `string` | Yes      | Export format: `geojson` or `kml` (case-insensitive). |

The format parameter is parsed via `parseGeoExportFormat(rawFormat)`, which trims whitespace and lowercases the input. If `format` is missing or unsupported, the route returns an HTTP 400 JSON error without querying the database:

- Missing: `{"error": "Missing required \"format\" query parameter. Supported formats: geojson, kml"}`
- Unsupported: `{"error": "Unsupported export format. Supported formats: geojson, kml"}`

### Database Query & Field Filtering

The handler executes a single query to retrieve all venues associated with the folder:

```typescript
const folderVenues = await prisma.folderVenue.findMany({
  where: { folderId: id },
  select: { venue: { select: GEO_EXPORT_VENUE_SELECT } },
  orderBy: { createdAt: "desc" },
});
```

The `GEO_EXPORT_VENUE_SELECT` filter limits selected fields to: `id`, `name`, `latitude`, `longitude`, `address`, `category`, `wifiQuality`, `wifiSpeed`, and 14 boolean amenity flags. Sensitive venue attributes (such as `ownerId`, `hostMessage`, internal notes, and third-party place IDs) are excluded.

### Coordinate Validation & Filtering

Venues are filtered using `hasValidCoordinates(venue)` before serialization. A venue is included only if:

- `latitude` and `longitude` are finite numbers.
- `(latitude, longitude)` is not `(0, 0)`. WorkSphere assigns `(0, 0)` as a placeholder for venues with unknown coordinates; placeholder coordinates are rejected.
- Latitude is between `-90` and `90` (inclusive).
- Longitude is between `-180` and `180` (inclusive).

Venues failing coordinate validation are omitted from both GeoJSON and KML outputs. If a folder contains no venues or no venues with valid coordinates, an empty collection is returned.

### GeoJSON Output (`format=geojson`)

When `format=geojson`, the handler passes the venue array to `generateGeoJson(venues)` (`venuesToGeoJson` in `src/lib/export/domain/geoExporter.ts`).

- **Structure:** RFC 7946 `FeatureCollection`.
- **Features:** Array of `Point` features.
- **Coordinates:** `[longitude, latitude]` (RFC 7946 longitude-first order).
- **Properties Object:**
  - `name` (`string`): Venue display name.
  - `address` (`string | null`): Physical address.
  - `category` (`string`): Venue category (e.g., `"coworking"`, `"cafe"`, `"library"`).
  - `amenities` (`string[]`): Normalized amenity labels derived from venue flags.
  - `workSphereUrl` (`string`): Absolute URL to view the venue on WorkSphere, constructed via `appUrl("/venues/{venueId}")` using the application's resolved base URL. The base URL is selected dynamically by evaluating:
    1. `NEXT_PUBLIC_APP_URL` (if set),
    2. `VERCEL_URL` (if deployed on Vercel),
    3. `http://localhost:3000` (development fallback).
       This value is an absolute link built from the current deployment environment configuration rather than a guaranteed canonical production URL.

> [!IMPORTANT]
> **No Folder Metadata or Bounding Polygon:**
> The route invokes `generateGeoJson(venues)` passing only the array of venues, not the folder object or boundary options. Consequently, the resulting GeoJSON `FeatureCollection` does not include folder-level metadata properties (`folderId`, `folderName`, `description`) or a spatial collection bounding polygon feature.

#### Amenity Derivation

The `amenities` array is derived by `normalizeVenueAmenities`:

- If `wifiSpeed > 0` or `wifiQuality > 0`, adds `"Wi-Fi"`.
- Maps active boolean flags: `hasOutlets` ("Power outlets"), `hasErgonomic` ("Ergonomic seating"), `hasPhoneBooths` ("Phone booths"), `hasQuietZone` ("Quiet zone"), `hasNoMusic` ("No music"), `hasAncHeadsetRental` ("ANC headset rental"), `singleOriginBeans` ("Single-origin beans"), `specialtyEspresso` ("Specialty espresso"), `oatAlmondMilk` ("Oat/almond milk"), `pourOverAvailable` ("Pour-over coffee"), `petsAllowedIndoors` ("Pets allowed indoors"), `dogFriendly` ("Dog friendly"), `catsAllowed` ("Cats allowed"), `waterBowlsProvided` ("Water bowls provided").

#### Example GeoJSON Response

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "venue_cuid_101",
      "geometry": {
        "type": "Point",
        "coordinates": [-122.4018, 37.7892]
      },
      "properties": {
        "name": "SoMa Focus Hub",
        "address": "456 Howard St, San Francisco, CA",
        "category": "coworking",
        "amenities": [
          "Wi-Fi",
          "Power outlets",
          "Phone booths",
          "Ergonomic seating"
        ],
        "workSphereUrl": "https://worksphere.example/venues/venue_cuid_101"
      }
    }
  ]
}
```

### KML Output (`format=kml`)

When `format=kml`, the handler invokes `generateKml(venues, { name: folder.name, description: folder.description })`.

- **Standard:** OGC KML 2.2 (`xmlns="http://www.opengis.net/kml/2.2"`).
- **Document Metadata:**
  - `<name>`: Escaped folder name (defaults to `"Collection"` if empty).
  - `<description>`: Escaped folder description (omitted if null or empty).
  - `<ExtendedData>`: Contains `<Data name="exportedAt">` (ISO timestamp) and `<Data name="generator">` (`WorkSphere`).
- **Placemarks:** Each valid venue is rendered as a `<Placemark id="venue-{venue.id}">`:
  - `<name>`: Escaped venue name.
  - `<description>`: CDATA block containing formatted HTML with address, category, amenities list, and link to view on WorkSphere.
  - `<address>`: Escaped venue address (omitted if address is null).
  - `<Point><coordinates>{longitude},{latitude},0</coordinates></Point>`: Coordinates formatted with up to 7 decimal places.

The route does not generate or export collection boundary polygons in KML.

#### Example KML Response

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>San Francisco Team Spaces</name>
    <description>Curated quiet spots and coworking venues.</description>
    <ExtendedData>
      <Data name="exportedAt"><value>2026-11-22T08:00:00.000Z</value></Data>
      <Data name="generator"><value>WorkSphere</value></Data>
    </ExtendedData>
    <Placemark id="venue-venue_cuid_101">
      <name>SoMa Focus Hub</name>
      <description><![CDATA[
        <b>Address:</b> 456 Howard St, San Francisco, CA<br/>
        <b>Category:</b> coworking<br/>
        <b>Amenities:</b> Wi-Fi, Power outlets, Phone booths, Ergonomic seating<br/>
        <a href="https://worksphere.example/venues/venue_cuid_101">View on WorkSphere</a>
      ]]></description>
      <address>456 Howard St, San Francisco, CA</address>
      <Point>
        <coordinates>-122.4018,37.7892,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>
```

---

## 4. PDF Catalog Summary Export API

Generates a formatted PDF report summarizing the folder and its saved venues.

### Endpoint

```http
GET /api/folders/{id}/export-pdf
```

### Path Parameters

| Parameter | Type     | Required | Description                                   |
| :-------- | :------- | :------- | :-------------------------------------------- |
| `id`      | `string` | Yes      | The unique database identifier of the folder. |

### PDF Content Assembly

1. **Folder Information:** Sourced from `folder.name` and `folder.description`.
2. **Venue Details:** Sourced from `FolderVenue` -> `Venue`:
   - Venue Name (`name`)
   - Wi-Fi Quality rating (`wifiQuality`, 1-5 scale)
   - Outlet availability indicator (`hasOutlets`)
   - Physical address (`address`)
3. **Requesting User's Private Notes:**
   The endpoint queries `prisma.favorite.findMany`:
   ```typescript
   prisma.favorite.findMany({
     where: { userId, venueId: { in: venueIds } },
     select: { venueId: true, notes: true },
   });
   ```
   > [!IMPORTANT]
   > **User-Specific Notes:**
   > Notes included in the PDF are retrieved strictly from the **requesting user's personal favorites** for the venues in the folder. They represent the viewer's private annotations, not shared folder notes. If another folder member exports the PDF, they will see their own private notes for those venues (or blank if they have not favorited or annotated them).

### Document Layout

Rendered via `generateFolderSummaryPdf` in `src/lib/export/domain/folderPdfExporter.ts`:

- Header banner: `"WorkSphere Collection Report"` with folder name and description.
- Generation timestamp and venue count.
- Per-venue entry blocks showing name, address, Wi-Fi rating, outlet status, and notes.
- Empty collection handling: If the folder has no venues, renders `"No venues saved in this collection yet."`.

---

## 5. Billing CSV Export API

Compiles confirmed booking history for all venues in a folder into a CSV file.

### Endpoint

```http
GET /api/folders/{id}/export-billing
```

### Path Parameters

| Parameter | Type     | Required | Description                                   |
| :-------- | :------- | :------- | :-------------------------------------------- |
| `id`      | `string` | Yes      | The unique database identifier of the folder. |

### Booking Selection Criteria

The endpoint retrieves billing records using a two-step query:

1. Retrieves all `venueId` records linked to `folderId` via `prisma.folderVenue`.
2. Queries bookings for those venues:
   ```typescript
   prisma.booking.findMany({
     where: {
       venueId: { in: venueIds },
       status: "CONFIRMED",
     },
     include: {
       venue: { select: { name: true } },
       user: { select: { firstName: true, lastName: true, email: true } },
     },
     orderBy: { date: "desc" },
   });
   ```

> [!NOTE]
> **Confirmed Bookings Only:**
> Only bookings with `status === "CONFIRMED"` are exported. All bookings with any other status are excluded. Bookings are sorted by date in descending order (`date: "desc"`).

### CSV Columns & Data Mapping

| Column Header      | Source Field / Derivation                       | Description / Fallback                                                        |
| :----------------- | :---------------------------------------------- | :---------------------------------------------------------------------------- |
| `Date`             | `booking.date`                                  | Date of the reservation (e.g. `"2026-10-15"`).                                |
| `Venue Name`       | `booking.venue.name`                            | Associated venue name, wrapped in quotes with `"` escaped as `""`.            |
| `User Name`        | `booking.user.firstName` + `lastName`           | User display name, falling back to `"Anonymous"` if empty. Escaped in quotes. |
| `User Email`       | `booking.user.email \|\| booking.customerEmail` | Authenticated user email, falling back to booking customer email.             |
| `Duration (mins)`  | `booking.duration`                              | Reserved duration in minutes; defaults to `60` if null or 0.                  |
| `Billing Code`     | `booking.projectBillingCode`                    | Project billing allocation code; defaults to `"N/A"` if null.                 |
| `Confirmation ID`  | `booking.confirmationId`                        | Unique human-readable reservation confirmation code.                          |
| `Mock Expense ($)` | `(15 + duration * 0.25).toFixed(2)`             | Heuristic mock expense calculation.                                           |

### Mock Expense Calculation

The route calculates a mock expense estimate using the formula:

$$\text{Mock Expense} = \$15.00 + (\text{duration in minutes} \times \$0.25)$$

The result is formatted to two decimal places (`.toFixed(2)`).

- **Example 1:** A default 60-minute booking:
  $\$15.00 + (60 \times \$0.25) = \$15.00 + \$15.00 = \$30.00$
- **Example 2:** A 120-minute booking:
  $\$15.00 + (120 \times \$0.25) = \$15.00 + \$30.00 = \$45.00$

> [!WARNING]
> **Heuristic Estimate Only:**
> The "Mock Expense" column is a synthetic heuristic estimate used for workspace budgeting mockups. It **does not** represent an actual monetary charge, credit card transaction, invoice settlement, or verified billing payment.

### CSV Construction & Security Considerations

The billing export handler manually constructs CSV rows via string concatenation:

```typescript
const csvContent = [
  headers.join(","),
  ...rows.map((row) => row.join(",")),
].join("\n");
```

- **Escaping Implementation:** Quote escaping (`replace(/"/g, '""')`) is applied only to `Venue Name` and `User Name`.
- **No Shared CsvBuilder Usage:** This endpoint does **not** call `src/lib/csv/CsvBuilder.ts`, `escapeCSVField`, or `sanitizeExcelFormula`.
- **Spreadsheet Formula Injection:** Cells beginning with `=`, `+`, `-`, or `@` (e.g. in confirmation IDs or billing codes) are not prefixed with single quotes (`'`).
- **Line Delimiters and Encoding:** Uses Unix line feeds (`\n`) without a UTF-8 Byte Order Mark (`\uFEFF`).

---

## 6. Download Behavior and Response Headers

All three export routes configure HTTP headers to trigger browser downloads and control caching.

### Response Headers Summary

| Export Route    | `Content-Type`                         | `Content-Disposition`                          | `Cache-Control` | Filename Pattern                                                                                                 |
| :-------------- | :------------------------------------- | :--------------------------------------------- | :-------------- | :--------------------------------------------------------------------------------------------------------------- |
| **GeoJSON**     | `application/geo+json`                 | `attachment; filename="{slug}.geojson"`        | `no-store`      | `{folder-slug}.geojson`                                                                                          |
| **KML**         | `application/vnd.google-earth.kml+xml` | `attachment; filename="{slug}.kml"`            | `no-store`      | `{folder-slug}.kml`                                                                                              |
| **PDF**         | `application/pdf`                      | `attachment; filename="collection-{slug}.pdf"` | Default         | `collection-{folder-slug}.pdf`                                                                                   |
| **Billing CSV** | `text/csv`                             | `attachment; filename="{filename}.csv"`        | `no-cache`      | `billing-export-${folder.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv` |

### Filename Derivation Rules

1. **Geographic Filename (`buildGeoExportFilename`):**
   - Normalized slug: `folderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "")`
   - Fallback: `"collection"`
   - Final name: `<slug>.<format>` (e.g., `design-team-spaces.geojson` or `collection.kml`).
2. **PDF Filename:**
   - Slug: `folderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")`
   - Fallback: `"report"`
   - Final name: `collection-<slug>.pdf` (e.g., `collection-design-team-spaces.pdf` or `collection-report.pdf`).
3. **Billing CSV Filename:**
   Constructed directly using the template expression:
   ```typescript
   `billing-export-${folder.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
   ```
   - **Lowercased Folder Name:** `folder.name.toLowerCase()` converts uppercase letters to lowercase.
   - **Whitespace Replacement:** Only whitespace characters are matched (`/\s+/g`) and replaced with a hyphen (`"-"`). Consecutive spaces become a single hyphen.
   - **Unsanitized Punctuation:** Unlike the geographic and PDF slug generators, other characters, punctuation, and symbols (such as commas, quotes, parentheses, exclamation marks, or non-ASCII characters) are **not** stripped or sanitized.
   - **UTC ISO Date Stamp:** The date is extracted from the server's current UTC ISO 8601 timestamp (`new Date().toISOString().split("T")[0]`), resulting in a `YYYY-MM-DD` string in UTC (which may differ from local server or user timezones near midnight).
   - This output is not a fully normalized slug.

---

## 7. Error Responses

The endpoints differ in error payload format: **Geographic export returns JSON error objects**, while **PDF export and Billing CSV export return plain-text error bodies**.

| Scenario                    | HTTP Status                 | Geographic Export Body (JSON)                                                               | PDF Export Body (Plain Text) | Billing CSV Export Body (Plain Text) |
| :-------------------------- | :-------------------------- | :------------------------------------------------------------------------------------------ | :--------------------------- | :----------------------------------- |
| **Missing Auth Session**    | `401 Unauthorized`          | `{"error": "Unauthorized"}`                                                                 | `Unauthorized`               | `Unauthorized`                       |
| **Missing `format` Param**  | `400 Bad Request`           | `{"error": "Missing required \"format\" query parameter. Supported formats: geojson, kml"}` | _N/A_                        | _N/A_                                |
| **Unsupported `format`**    | `400 Bad Request`           | `{"error": "Unsupported export format. Supported formats: geojson, kml"}`                   | _N/A_                        | _N/A_                                |
| **Folder Not Found**        | `404 Not Found`             | `{"error": "Folder not found"}`                                                             | `Folder not found`           | `Folder not found`                   |
| **Access Forbidden**        | `403 Forbidden`             | `{"error": "Forbidden"}`                                                                    | `Forbidden`                  | `Forbidden`                          |
| **Server / Database Error** | `500 Internal Server Error` | `{"error": "Failed to export folder"}`                                                      | `Failed to export PDF`       | `Failed to generate export`          |

---

## 8. Representative Request Examples

### 1. Download GeoJSON FeatureCollection

```http
GET /api/folders/cuid_folder_123/export?format=geojson HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/geo+json
```

**Response:**

```http
HTTP/1.1 200 OK
Content-Type: application/geo+json
Content-Disposition: attachment; filename="team-venues.geojson"
Cache-Control: no-store

{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "venue_abc123",
      "geometry": {
        "type": "Point",
        "coordinates": [-74.006, 40.7128]
      },
      "properties": {
        "name": "Manhattan Work Lounge",
        "address": "100 Broadway, New York, NY",
        "category": "coworking",
        "amenities": ["Wi-Fi", "Power outlets", "Phone booths"],
        "workSphereUrl": "https://worksphere.example/venues/venue_abc123"
      }
    }
  ]
}
```

### 2. Download KML Document

```http
GET /api/folders/cuid_folder_123/export?format=kml HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
```

**Response:**

```http
HTTP/1.1 200 OK
Content-Type: application/vnd.google-earth.kml+xml
Content-Disposition: attachment; filename="team-venues.kml"
Cache-Control: no-store

<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Team Venues</name>
    <ExtendedData>
      <Data name="exportedAt"><value>2026-11-22T08:00:00.000Z</value></Data>
      <Data name="generator"><value>WorkSphere</value></Data>
    </ExtendedData>
    <Placemark id="venue-venue_abc123">
      <name>Manhattan Work Lounge</name>
      <description><![CDATA[
        <b>Address:</b> 100 Broadway, New York, NY<br/>
        <b>Category:</b> coworking<br/>
        <b>Amenities:</b> Wi-Fi, Power outlets, Phone booths<br/>
        <a href="https://worksphere.example/venues/venue_abc123">View on WorkSphere</a>
      ]]></description>
      <address>100 Broadway, New York, NY</address>
      <Point>
        <coordinates>-74.006,40.7128,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>
```

### 3. Download PDF Summary

```http
GET /api/folders/cuid_folder_123/export-pdf HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: application/pdf
```

**Response:**

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="collection-team-venues.pdf"

%PDF-1.7
... <binary PDF bytes> ...
```

### 4. Download Billing CSV

```http
GET /api/folders/cuid_folder_123/export-billing HTTP/1.1
Host: worksphere.example
Cookie: __session=<clerk-session-token>
Accept: text/csv
```

**Response:**

```http
HTTP/1.1 200 OK
Content-Type: text/csv
Content-Disposition: attachment; filename="billing-export-team-venues-2026-11-22.csv"
Cache-Control: no-cache

Date,Venue Name,User Name,User Email,Duration (mins),Billing Code,Confirmation ID,Mock Expense ($)
2026-11-20,"Manhattan Work Lounge","Jordan Lee",jordan@example.com,120,PROJ-ALPHA,WS-CONF-9876,45.00
2026-11-18,"SoMa Focus Hub","Anonymous",guest@example.com,60,N/A,WS-CONF-5432,30.00
```

---

## 9. Important Implementation Limitations

1. **No External Payment or Verified Invoicing:**
   The billing export endpoint does not integrate with accounting software, payment gateways, or live ledger charges. All figures in `Mock Expense ($)` are computed using a mock formula (`$15 + duration * $0.25`).
2. **Billing CSV Sanitization Limitations:**
   The billing export endpoint does not use the project's central `CsvBuilder` or formula injection sanitizers. Clients should exercise caution if opening billing exports containing user-supplied strings directly in desktop spreadsheet applications.
3. **GeoJSON Route Excludes Folder Metadata and Polygon Boundary:**
   While `geoExporter.ts` supports boundary polygon generation and folder metadata, the route handler `src/app/api/folders/[id]/export/route.ts` passes only `venues` to `generateGeoJson(venues)`. The route output contains only venue point features.
4. **Coordinate Exclusion:**
   Venues without valid geographical coordinates (including placeholder coordinates `(0, 0)`) are excluded from geographic export files without warning or error headers.
5. **PDF Notes Are Viewer-Specific:**
   Venue notes in the exported PDF are sourced from the authenticated requester's personal favorite records, not from a shared folder annotation model.

---

## 10. Related Documentation

- [WorkSphere API Reference](../API_REFERENCE.md) — Comprehensive directory of all WorkSphere API endpoints.
- [API Documentation Index](./README.md) — Directory of endpoint-specific guides and OpenAPI specifications.
- [CSV & Excel Export Architecture Guide](../export/CSV_EXCEL_EXPORT_GUIDE.md) — Shared export builders, RFC 4180 compliance, and formula sanitization.
- [REST API Reference](../API.md) — Core schemas, authentication conventions, and global event contracts.
