# OSRM Local Routing Server Setup Guide

This guide details how to run a local instance of the **Open Source Routing Machine (OSRM)** using Docker, configure Next.js to redirect routing requests, and implement caching to accelerate route calculations and avoid public API rate limits.

---

## 1. Local OSRM Server with Docker

The public OSRM server (`https://router.project-osrm.org`) is rate-limited and not recommended for high-volume local testing or production use. Running OSRM locally inside Docker provides fast, offline, and unlimited routing requests.

### Prerequisites
* [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
* At least 2–4 GB of free RAM allocated to Docker (depending on the map size).

### Step 1: Download Map Extracts
OSRM requires map data in the `.osm.pbf` format. Download the region file corresponding to your development requirements:
* **Global Extracts**: [Geofabrik Download Server](https://download.geofabrik.de/) (e.g., download `us-east-latest.osm.pbf` or `new-york-latest.osm.pbf`).
* **Custom Regions**: [BBBike OSM Extracts](https://download.bbbike.org/osm/) (allows downloading custom bounding box coordinate ranges).

Create a directory to store the map data in your project or home directory:
```bash
mkdir osrm-data
# Move your downloaded .osm.pbf file into this folder
```

### Step 2: Choose a Routing Profile
OSRM uses profiles to calculate routes based on transit type. The built-in profiles are:
* `/profile/foot.ini` (Walking)
* `/profile/bicycle.ini` (Cycling)
* `/profile/car.ini` (Driving)

### Step 3: Process the Map Data
Run the following three commands in sequence to compile the map extract for OSRM. Replace `new-york-latest.osm.pbf` with the name of the file you downloaded.

> [!IMPORTANT]
> OSRM processes one profile at a time. If you want to use multiple profiles locally, you must run these steps separately for each profile and output to distinct files (e.g., `new-york-foot.osrm`, `new-york-car.osrm`).

#### A. Extract routing graphs
```bash
docker run -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-extract -p /profile/foot.ini /data/new-york-latest.osm.pbf
```

#### B. Partition the graphs
```bash
docker run -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-partition /data/new-york-latest.osrm
```

#### C. Customize the cells
```bash
docker run -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-customize /data/new-york-latest.osrm
```

### Step 4: Run the Routing Engine Server
Start the HTTP routing engine container mapping to port `5000`:
```bash
docker run -d -p 5000:5000 --name osrm-routed-foot -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/new-york-latest.osrm
```

### Step 5: Verify the Local Server
Open your browser or run a curl command to test the engine:
```bash
curl "http://localhost:5000/route/v1/foot/-73.9857,40.7484;-73.9880,40.7490?overview=full&geometries=geojson"
```
If you get a JSON response with status `"code": "Ok"`, your local routing server is ready!

---

## 2. Next.js Routing Configuration

WorkSphere uses Next.js **Rewrites** to proxy OSRM client-side fetches. This approach solves two problems:
1. **CORS Errors**: Requests are made to the same origin (`/osrm/route/v1/...`), avoiding cross-origin issues.
2. **Environment Portability**: The base endpoint can be updated globally via environment variables without altering client-side code.

### How Next.js Rewrites Work
The codebase fetches routes relative to the host:
```typescript
const url = `/osrm/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;
```

In [next.config.ts](file:///c:/Users/ADMIN/OneDrive/Desktop/ECSoC/WorkSphere/next.config.ts), rewrites proxy these requests to the destination set by `NEXT_PUBLIC_OSRM_URL`:

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ...other config options
  async rewrites() {
    const osrmUrl = process.env.NEXT_PUBLIC_OSRM_URL || "https://router.project-osrm.org";
    return [
      {
        source: "/osrm/:path*",
        destination: `${osrmUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

### Setting up Local Development Redirect
To point the application to your local Docker routing container, add the following variable to your `.env.local` file:

```env
# Point to your local Docker OSRM container running on port 5000
NEXT_PUBLIC_OSRM_URL=http://localhost:5000
```

When you restart the Next.js dev server, any client routing request to `/osrm/...` will automatically be proxied to `http://localhost:5000`. If `NEXT_PUBLIC_OSRM_URL` is omitted, it seamlessly falls back to the public demo routing servers.

### Multi-Profile Support (Advanced)
Because the OSRM container runs a single profile per port, if you run multiple profiles, spin up containers on different ports (e.g. `5001` for foot, `5002` for bicycle, `5003` for car) and update the rewrite targets:

```typescript
// next.config.ts (Multi-profile rewriting example)
async rewrites() {
  return [
    {
      source: "/osrm/route/v1/foot/:path*",
      destination: `${process.env.OSRM_FOOT_URL || "http://localhost:5001"}/route/v1/foot/:path*`,
    },
    {
      source: "/osrm/route/v1/driving/:path*",
      destination: `${process.env.OSRM_CAR_URL || "http://localhost:5003"}/route/v1/driving/:path*`,
    },
    {
      source: "/osrm/route/v1/:path*",
      destination: "https://router.project-osrm.org/route/v1/:path*", // fallback
    }
  ];
}
```

---

## 3. Caching Routes

OSRM calculations can take several milliseconds to process. Caching results speeds up map rendering, preserves server CPU, and ensures offline capabilities when standard client requests fail.

### Option A: Browser-level Session Cache (Client-side)
If users toggle between views frequently, store fetched routes in memory or `sessionStorage` in the React context/hooks before executing network calls.

```typescript
// Example: Client-side routing hook with memory cache
const routeCache = new Map<string, any>();

export function useCachedDirections() {
  const calculateRoute = async (start: { lat: number, lng: number }, end: { lat: number, lng: number }) => {
    const cacheKey = `${start.lat},${start.lng};${end.lat},${end.lng}`;
    
    if (routeCache.has(cacheKey)) {
      return routeCache.get(cacheKey);
    }
    
    const response = await fetch(`/osrm/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
    const data = await response.json();
    
    if (data.code === "Ok") {
      routeCache.set(cacheKey, data);
    }
    return data;
  };
}
```

### Option B: Server-Side Redis Caching (Recommended for Production)
For shared team caching, route OSRM queries through a custom Next.js API Route Handler that caches responses in Redis (e.g., via Upstash Redis).

```typescript
// src/app/api/route/route.ts
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : null;
const OSRM_BACKEND = process.env.NEXT_PUBLIC_OSRM_URL || "https://router.project-osrm.org";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start'); // format: "lng,lat"
  const end = searchParams.get('end');     // format: "lng,lat"
  const profile = searchParams.get('profile') || 'foot';

  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start or end coordinates' }, { status: 400 });
  }

  const cacheKey = `route:${profile}:${start}:${end}`;

  // 1. Attempt cache retrieval
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(cached);
      }
    } catch (err) {
      console.error("Redis Cache Read Failure:", err);
    }
  }

  // 2. Query OSRM server
  const osrmUrl = `${OSRM_BACKEND}/route/v1/${profile}/${start};${end}?overview=full&geometries=geojson`;
  
  try {
    const res = await fetch(osrmUrl);
    const data = await res.json();

    if (res.ok && data.code === "Ok" && redis) {
      // Cache results for 24 hours (86400 seconds)
      await redis.set(cacheKey, data, { ex: 86400 });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

---

## 4. Verification & Diagnostics

Once OSRM is configured locally, check the browser console during map navigation:
1. Open **Chrome DevTools** (F12) → **Network Tab**.
2. Trigger a route query by clicking a recommended venue marker.
3. Search for `/osrm/route/v1/...` in the Network filters.
4. Verify that:
   * Status code is `200 OK` (or `304 Not Modified`).
   * **Request URL** matches your host (e.g., `http://localhost:3000/osrm/route/...`).
   * Response payload contains correct geometry coordinates.
