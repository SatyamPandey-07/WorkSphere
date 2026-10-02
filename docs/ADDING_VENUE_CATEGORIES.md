# Guide: Adding New Venue Categories to WorkSphere

This step-by-step contribution guide explains how to introduce a completely new venue category into WorkSphere.

Whether you are adding **Hotel Lobbies**, **Makerspaces**, **Bookstores**, or **Outdoor Plazas**, WorkSphere requires synchronized updates across the data layer, API validation schemas, interactive UI filters, map marker icons, and local seed scripts.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites & Development Setup](#2-prerequisites--development-setup)
3. [Step 1 — Update Prisma Schema & Validation Enums](#step-1--update-prisma-schema--validation-enums)
4. [Step 2 — Update UI Filter Components](#step-2--update-ui-filter-components)
5. [Step 3 — Add Map Marker & Category Visual Icons](#step-3--add-map-marker--category-visual-icons)
6. [Step 4 — Update Seed Data](#step-4--update-seed-data)
7. [Step 5 — Verify Changes Locally](#step-5--verify-changes-locally)
8. [Contributor Pre-Flight Checklist](#8-contributor-pre-flight-checklist)

---

## 1. Overview

### What is a Venue Category?

In WorkSphere, a **venue category** classifies the physical environment where remote workers, nomads, and students go to be productive. The application currently supports three core categories:

- `cafe` (Cafes & Coffee Shops)
- `coworking` (Coworking Spaces & Shared Studios)
- `library` (Public & University Libraries)

### Why Adding a Category Requires Multiple Changes

WorkSphere is a full-stack Next.js application built with TypeScript, Prisma ORM, PostgreSQL, Zod validation, and Leaflet interactive maps. A venue category is not merely a visual label; it participates in:

- **Database Persistence**: Saved in the `Venue` table in PostgreSQL.
- **API Request Validation**: Checked at runtime by Zod schemas on venue creation and search endpoints.
- **Search & Filtering**: Filtered in the venue discovery drawer and API query handlers.
- **Map Visualization & Accessibility**: Rendered on the Leaflet map with custom icons, accessibility labels, and popup badges.
- **Social & Public Collections**: Displayed on individual venue pages (`/venues/[id]`), saved venue cards, and public shared lists.
- **Local Testing & Seeding**: Instantiated in `prisma/seed.js` for development environments.

If you add a category in only one location (for example, just the UI dropdown), backend API requests will fail Zod validation, or map popups will fall back to generic icons.

---

## 2. Prerequisites & Development Setup

Before making code changes, ensure your local development environment is set up according to the repository's [CONTRIBUTING.md](../CONTRIBUTING.md) and [BEGINNER_SETUP_GUIDE.md](./BEGINNER_SETUP_GUIDE.md).

### 2.1 System Requirements

- **Node.js**: v18.x or v20.x LTS (recommended).
- **npm**: v9.x or higher.
- **Git**: Installed and configured.
- **PostgreSQL Database**: Either a local instance via Docker Compose (`docker compose up -d`) or a remote instance (such as Neon PostgreSQL).

### 2.2 Local Repository Setup

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Configure environment variables (if not already done)
cp .env.example .env.local

# 3. Ensure Prisma client is generated
npx prisma generate

# 4. Start the local development server
npm run dev
```

The application will be accessible at `http://localhost:3000`.

---

## Step 1 — Update Prisma Schema & Validation Enums

### 1.1 Update the Prisma Schema

- **File Path**: `prisma/schema.prisma`

In WorkSphere's PostgreSQL schema, the `Venue` model stores the category as a `String` column, with permitted values documented via inline comments:

```prisma
model Venue {
  id                  String              @id @default(cuid())
  placeId             String              @unique
  name                String
  latitude            Float
  longitude           Float
  category            String // cafe, coworking, library
  address             String?
  rating              Float?
  // ...other fields
}
```

When adding a new category (for example, `hotel_lobby`), update the schema comment in `prisma/schema.prisma`:

```prisma
  category            String // cafe, coworking, library, hotel_lobby
```

#### Are Prisma Migrations Required?

- **If keeping the column as `String`**: Changing a code comment in `schema.prisma` does not alter the underlying PostgreSQL table structure. A migration is **not required**, but you should run `npx prisma generate` to re-sync the Prisma client types.
- **If converting to or adding a formal Prisma `enum`**:
  If the repository introduces a native PostgreSQL enum `enum VenueCategory`, generate and apply a formal migration:
  ```bash
  npx prisma migrate dev --name add_hotel_lobby_category
  ```
  For rapid local prototyping against a development database without generating migration files:
  ```bash
  npx prisma db push
  ```

### 1.2 Update Zod API Validation Schemas

WorkSphere strictly enforces input validation at runtime using **Zod**. You must update two validation files so the API routes accept the new category value:

#### A. Venue Creation Schema

- **File Path**: `src/lib/validations.ts`

Locate `venueCreateSchema` (around line 33) and add the new category to the `z.enum`:

```typescript
export const venueCreateSchema = z.object({
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  category: z.enum(["cafe", "coworking", "library", "hotel_lobby"]), // <-- Add new category
  address: z.string().max(500).optional(),
  // ...other fields
});
```

#### B. Search & Filter Schema

- **File Path**: `src/lib/filters.ts`

Locate `buildVenueSearchSchema()` (around line 156) and update the `category` filter enum:

```typescript
export function buildVenueSearchSchema() {
  const shape: Record<string, z.ZodTypeAny> = {
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radius: z.coerce.number().min(100).max(50000).default(5000),
    category: z
      .enum(["cafe", "coworking", "library", "hotel_lobby", "all"])
      .optional(), // <-- Add new category
    cities: z.string().optional(),
  };
  // ...
  return z.object(shape);
}
```

### 1.3 Update Category Constants

- **File Path**: `src/lib/venues.ts`

Locate `WORKSPACE_CATEGORIES` (around line 589) and register the new constant:

```typescript
export const WORKSPACE_CATEGORIES = {
  CAFE: "cafe",
  COFFEE_SHOP: "coffee",
  COWORKING: "coworking",
  LIBRARY: "library",
  HOTEL_LOBBY: "hotel_lobby", // <-- Add new category key
  ALL: "cafe,coworking,library,hotel_lobby",
};
```

---

## Step 2 — Update UI Filter Components

To allow users to filter by and submit venues with the new category, update the filter drawer and venue submission modal.

### 2.1 Update Venue Search Drawer

- **File Path**: `src/components/venues/VenueSearchDrawer.tsx`

Locate `CATEGORIES_LIST` (around line 31) and append the new category object with an `id` matching your enum and a user-facing `label`:

```typescript
export const CATEGORIES_LIST = [
  { id: "all", label: "All Types" },
  { id: "cafe", label: "Cafes" },
  { id: "coworking", label: "Coworking" },
  { id: "library", label: "Libraries" },
  { id: "hotel_lobby", label: "Hotel Lobbies" }, // <-- Add here
];
```

#### How it Becomes Selectable in the UI

`VenueSearchDrawer.tsx` dynamically iterates over `CATEGORIES_LIST` to render accessible filter chips:

```tsx
<div className="flex flex-wrap gap-2">
  {CATEGORIES_LIST.map((item) => (
    <button
      key={item.id}
      type="button"
      data-testid={`category-${item.id}`}
      onClick={() => handleCategoryChange(item.id)}
      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
        cat === item.id
          ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
      }`}
    >
      {item.label}
    </button>
  ))}
</div>
```

When a user taps the button, `handleCategoryChange` passes the category ID (`hotel_lobby`) to parent filters, querying `/api/venues?category=hotel_lobby`.

### 2.2 Update Venue Submission Modal

- **File Path**: `src/components/VenueSubmissionModal.tsx`

When contributors or users submit new crowdsourced venues via the UI, the category is chosen via a dropdown.

1. **Update the TypeScript Interface**:

   ```typescript
   interface VenueFormData {
     name: string;
     address: string;
     category: "cafe" | "coworking" | "library" | "hotel_lobby"; // <-- Update union type
     latitude: number | null;
     longitude: number | null;
     // ...other fields
   }
   ```

2. **Add the Dropdown Option**:
   Locate the `<select>` element (around line 391) and add the new option:
   ```tsx
   <select
     value={formData.category}
     onChange={(e) =>
       setFormData((prev) => ({
         ...prev,
         category: e.target.value as VenueFormData["category"],
       }))
     }
     className="..."
   >
     <option value="cafe">☕ Cafe</option>
     <option value="coworking">🏢 Coworking Space</option>
     <option value="library">📚 Library</option>
     <option value="hotel_lobby">🏨 Hotel Lobby</option> {/* <-- Add here */}
   </select>
   ```

---

## Step 3 — Add Map Marker & Category Visual Icons

WorkSphere uses **Lucide React** icons (`lucide-react`) to represent venue categories consistently across map popups, venue detail pages, public collections, and search cards.

### 3.1 Map Marker Accessibility & Tooltip Display

- **File Paths**: `src/components/ui/MapMarker.tsx` and `src/components/Map.tsx`

In `src/components/ui/MapMarker.tsx`, the `AccessibleMarker` component automatically reads the `category` prop to set accessible ARIA attributes:

```typescript
const label = isDestination
  ? `Destination: ${name}`
  : `Venue: ${name}${category ? `, ${category}` : ""}`;
el.setAttribute("aria-label", label);
```

In `src/components/Map.tsx`, the map popup displays the category text under the venue title:

```tsx
<AccessibleMarker
  position={[marker.renderedLat, marker.renderedLng]}
  icon={isDest ? destinationIcon : venueIcon}
  name={marker.name}
  category={marker.category}
>
  <div className="text-sm">
    <div className="font-semibold text-white">{marker.name}</div>
    {marker.category && (
      <div className="text-zinc-400 capitalize">
        {marker.category.replace("_", " ")}
      </div>
    )}
  </div>
</AccessibleMarker>
```

### 3.2 Update Venue Detail Page (`/venues/[id]`)

- **File Path**: `src/app/venues/[id]/page.tsx`

Import the appropriate icon from `lucide-react` (e.g., `Hotel`) and update the `CategoryIcon` resolver:

```tsx
import {
  MapPin,
  Wifi,
  Zap,
  Building2,
  Coffee,
  BookOpen,
  Hotel,
} from "lucide-react"; // <-- Import icon

// Inside VenueDetailPage component:
const CategoryIcon =
  venue.category === "cafe"
    ? Coffee
    : venue.category === "library"
      ? BookOpen
      : venue.category === "coworking_space" || venue.category === "coworking"
        ? Building2
        : venue.category === "hotel_lobby"
          ? Hotel // <-- Map new category icon
          : MapPin;

// Fallback Unsplash image for the new category
const fallbackImage =
  venue.category === "cafe"
    ? "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200"
    : venue.category === "library"
      ? "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=1200"
      : venue.category === "hotel_lobby"
        ? "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=1200" // <-- Add fallback image
        : "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200";
```

### 3.3 Update Public Collections & Saved Venue Badges

- **Public Collection Page** (`src/app/collections/public/[token]/page.tsx`):

  ```tsx
  import { Coffee, Building2, BookOpen, Hotel } from "lucide-react";

  const categoryIcons: Record<string, React.ReactNode> = {
    cafe: <Coffee className="w-4 h-4 text-amber-400" />,
    coworking: <Building2 className="w-4 h-4 text-indigo-400" />,
    library: <BookOpen className="w-4 h-4 text-emerald-400" />,
    hotel_lobby: <Hotel className="w-4 h-4 text-rose-400" />, // <-- Register icon & color
  };
  ```

- **Saved Venue Card** (`src/components/saved-venues/SavedVenueCard.tsx`):

  ```tsx
  const categoryColor =
    venue.category === "cafe"
      ? "text-amber-600"
      : venue.category === "coworking"
        ? "text-blue-600"
        : venue.category === "hotel_lobby"
          ? "text-rose-600" // <-- Distinct badge color
          : "text-green-600";
  ```

- **Chat & Dialog Components** (`src/components/chat/VenueDetailDialog.tsx` & `src/components/chat/ChatMessages.tsx`):
  Update the `CategoryIcon` conditional ternary to include `venue.category === "hotel_lobby" ? Hotel : ...`.

---

## Step 4 — Update Seed Data

To test your new category locally with realistic mock locations, add sample records to the database seed script.

- **File Path**: `prisma/seed.js`

### 4.1 Add Sample Venue to `mockVenues`

Locate the `mockVenues` array (lines 10–86) and append an entry using your new category:

```javascript
const mockVenues = [
  // ...existing cafes, coworking spaces, and libraries...
  {
    placeId: "osm-venue-6",
    name: "The Williamsburg Grand Hotel Lounge",
    latitude: 40.7188,
    longitude: -73.9625,
    category: "hotel_lobby", // <-- Use the exact category key
    address: "96 Wythe Ave, Brooklyn, NY 11249",
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
    hasErgonomic: true,
    outletDensity: "every_table",
    wifiSpeed: 200,
    crowdsourced: true,
  },
];
```

### 4.2 Run the Seed Process

Execute the Prisma seed script via `npm` / `npx`:

```bash
npx prisma db seed
```

This runs `node prisma/seed.js` (configured in `package.json`). You should see:

```text
Starting database seed...
Mock user created/verified: nomad@worksphere.dev
...
Venue seeded: The Williamsburg Grand Hotel Lounge
Rating seeded for venue: The Williamsburg Grand Hotel Lounge
Database seeding completed successfully!
```

> **Tip:** If you need to wipe and reset your local development database completely to verify fresh seeding, run:
>
> ```bash
> npx prisma migrate reset
> ```
>
> _(Warning: This resets all local database tables and re-executes `prisma/seed.js` automatically)._

---

## Step 5 — Verify Changes Locally

Before submitting your pull request, execute all project verification checks locally.

### 5.1 Run Automated Quality Checks

Run the four standard repository verification commands from [CONTRIBUTING.md](../CONTRIBUTING.md):

```bash
# 1. Type check without emitting files
npx tsc --noEmit

# 2. Lint for style and syntax issues
npm run lint

# 3. Run Jest unit and component test suites
npm test

# 4. Run the production build simulation
npm run build
```

All four commands must finish with **zero errors**.

### 5.2 Manual Browser Verification

1. **Start the Dev Server**:
   ```bash
   npm run dev
   ```
2. **Verify Filter Drawer**:
   - Navigate to `http://localhost:3000/ai` (or click on the search filter trigger).
   - Open the **Search & Filter Venues** drawer.
   - Verify that your new category button (e.g., `Hotel Lobbies`) appears in the Category list.
   - Click the button; confirm it toggles active state (`bg-blue-600 text-white`).
3. **Verify Map Display**:
   - Check that the seeded venue appears on the Leaflet map at its coordinates.
   - Click on the marker to open the popup. Confirm that the venue name and category display accurately.
4. **Verify Venue Detail Page**:
   - Navigate to `http://localhost:3000/venues/<venue-id>`.
   - Verify the category badge renders the assigned Lucide icon and text without broken layout or missing images.
5. **Verify Venue Submission Modal**:
   - Open the venue submission modal.
   - Confirm the new category option is selectable in the dropdown.
   - Submit a test venue and ensure the API accepts the payload with status `200/201`.

---

## 8. Contributor Pre-Flight Checklist

Before opening your pull request, verify that every item on this checklist is complete:

- [ ] **Prisma & Database**
  - [ ] Category comment/enum updated in `prisma/schema.prisma`
  - [ ] Prisma client regenerated (`npx prisma generate`)
  - [ ] Migration generated or schema pushed (`npx prisma db push` or `npx prisma migrate dev` if enum was altered)
- [ ] **Validation & Schemas**
  - [ ] `src/lib/validations.ts` updated (`venueCreateSchema`)
  - [ ] `src/lib/filters.ts` updated (`buildVenueSearchSchema`)
  - [ ] `src/lib/venues.ts` updated (`WORKSPACE_CATEGORIES`)
- [ ] **UI Filter & Forms**
  - [ ] `src/components/venues/VenueSearchDrawer.tsx` updated (`CATEGORIES_LIST`)
  - [ ] `src/components/VenueSubmissionModal.tsx` updated (`VenueFormData` & `<select>` options)
- [ ] **Map & Visual Assets**
  - [ ] `src/app/venues/[id]/page.tsx` updated with `lucide-react` icon & fallback image
  - [ ] `src/app/collections/public/[token]/page.tsx` updated with category icon & color
  - [ ] `src/components/saved-venues/SavedVenueCard.tsx` updated with category badge color
  - [ ] `src/components/chat/VenueDetailDialog.tsx` & `src/components/chat/ChatMessages.tsx` updated
- [ ] **Seed Data**
  - [ ] New sample venue added to `prisma/seed.js`
  - [ ] Seed successfully executed via `npx prisma db seed`
- [ ] **Quality Checks & Tests**
  - [ ] `npx tsc --noEmit` returns 0 errors
  - [ ] `npm run lint` returns 0 warnings/errors
  - [ ] `npm test` passes
  - [ ] `npm run build` completes successfully
- [ ] **Documentation & PR Standards**
  - [ ] Branch follows convention: `docs/topic-name` or `feature/your-feature-name`
  - [ ] PR title follows: `docs: create contribution guide for adding new venue categories (closes #2184)`
