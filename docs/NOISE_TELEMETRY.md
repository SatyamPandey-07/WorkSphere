# 🔊 Noise Level Telemetry & Decibel Ingestion Guide

This document provides a comprehensive technical guide to WorkSphere's noise level telemetry pipeline. It covers client-side digital signal processing (DSP), WebAssembly memory management, server-side decibel aggregation, noise categorization, database schema mapping, and integration with the multi-agent AI recommendation engine.

---

## 1. High-Level Telemetry Architecture

The noise level monitoring system consists of a real-time client-side sampling pipeline and a server-side ingestion and aggregation service.

```mermaid
flowchart TD
    subgraph Client [Client-Side Web/Mobile Audio DSP]
        Mic[Hardware Microphone] -->|navigator.mediaDevices.getUserMedia| Stream[Audio MediaStream]
        Stream -->|mediaStreamSource| Node[MediaStreamAudioSourceNode]
        Node -->|FFT Time Domain Data| Analyser[AnalyserNode]
        Analyser -->|samples: Float32Array| WASM[WASM RMS Compute]
        WASM -->|RMS Amplitude| DBConvert[JS Decibel Mapping]
    end

    subgraph API [Server-Side Ingestion Endpoint]
        DBConvert -->|POST JSON Payload| MetricsAPI[/api/venues/:venueId/noise-metrics]
        MetricsAPI -->|Validate bounds 30-90 dB| AuthCheck{User Authenticated?}
        AuthCheck -->|Yes| LinkUser[Associate with Clerk userId]
        AuthCheck -->|No| LinkGuest[Associate with guest-noise-reporter]
        LinkUser & LinkGuest --> UpdateRating[Upsert VenueRating Record]
        UpdateRating --> UpdateVenue[Update Venue noiseLevel Category]
    end

    subgraph DB [Database & Analytics Layer]
        UpdateVenue --> PostgreSQL[(Neon PostgreSQL DB)]
        PostgreSQL -->|Live Fetch GET| LiveBuckets[Time-of-day Rolling Averages]
        PostgreSQL -->|Semantic Search| AIOrchestrator[AI Recommendation Engine]
    end
```

---

## 2. Client-Side Decibel Sampling & Processing

WorkSphere utilizes the browser's **Web Audio API** in combination with a **WebAssembly (WASM)** acceleration layer to capture and process noise levels locally on the client.

### 2.1 Browser Permissions & Secure Contexts
* **Secure Context Required**: Access to hardware audio capture via `getUserMedia()` is restricted to secure contexts (`https://` domains and `http://localhost`).
* **Autoplay Restriction**: The browser's `AudioContext` is initialized in a suspended state and must be resumed via an explicit user gesture (e.g., clicking a button) to conform to browser autoplay protection rules.
* **Stream Cleaning**: Input audio tracks are requested with software enhancements disabled to prevent automatic modifications:
  ```typescript
  navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  ```
* **Event Handling**:
  * `devicechange`: Triggers a cleanup and re-request of the user media stream to support swapping input devices gracefully (e.g., connecting headphones).
  * `visibilitychange`: Suspends the `AudioContext` and triggers a cleanup when the app goes into the background, preventing resource leaks and keeping microphone usage transparent.

### 2.2 WebAssembly Memory Management (Issue #1039 Fixes)
To prevent memory leaks and out-of-memory crashes during continuous sampling, the client utilizes a bump-allocator compiled into WASM.
* **Buffer Alignment**: On 32-bit ARM Android Chrome, unaligned memory access crashes the browser. WorkSphere enforces strict **8-byte alignment** when calculating byte sizes and allocates buffers using the byte-offset constructor:
  ```typescript
  const bytesNeeded = align8(samples.length * Float32Array.BYTES_PER_ELEMENT);
  // Byte-offset construction avoids division errors and respects 4-byte boundaries
  const view = new Float32Array(wasm.memory.buffer, cachedBufferPtr, samples.length);
  ```
* **Pointer Caching**: Rather than allocating a new heap section for every frame, the JavaScript bridge maintains a persistent reference `cachedBufferPtr`. A new buffer is allocated only if the FFT size changes.
* **Memory Lifecycle**:
  ```
  [Unmounted/Idle] ──> [First Frame] ──> malloc() ──> [Active Sampling] ──> Reuse Pointer
                                                                                │
  [Unmount/Stop] <── resetHeap() <── free() <── [Cleanup Triggered] <───────────┘
  ```

### 2.3 Mathematical Formulas & Conversion Algorithms

#### Root Mean Square (RMS)
The WebAssembly module calculates the mathematical intensity of raw time-domain samples $x$ of length $N$:

$$\text{RMS} = \sqrt{\frac{1}{N}\sum_{i=1}^{N} x_i^2}$$

#### Decibel Conversion
JavaScript maps the resulting RMS value to a human-readable decibel scale using a calibration offset of $+100$ decibels relative to Full Scale ($dBFS$):

$$\text{dB} = \max\left(20, \min\left(120, 20 \log_{10}(\text{RMS}) + 100\right)\right)$$

```typescript
function rmsToApproxDb(rms: number): number {
  if (rms <= 0.00001) return 20; // Lower floor cut-off
  const dbfs = 20 * Math.log10(rms);
  return Math.max(20, Math.min(120, Math.round((dbfs + 100) * 10) / 10));
}
```

---

## 3. Server-Side Ingestion API Details

### 3.1 Endpoint Details
* **Method**: `POST`
* **Route**: `/api/venues/[venueId]/noise-metrics`
* **Content-Type**: `application/json`

### 3.2 JSON Payload Schema
The endpoint accepts two formats to maximize client compatibility:

#### Request Body:
```json
{
  "decibels": 42.5,
  "peakDecibels": 54.2
}
```
*Alternatively, the client can send `avgDecibels` instead of `decibels`.*

### 3.3 HTTP Response Schemas & Status Codes

#### `201 Created` (Success):
Returned when a telemetry point is recorded. Contains updated rolling aggregation statistics.
```json
{
  "success": true,
  "venueId": "cld2efgh-1234-5678-abcd-ef1234567890",
  "decibels": 42.5,
  "noiseLevel": "quiet",
  "buckets": [
    { "key": "morning", "label": "Morning", "averageDb": 41.2, "peakDb": 48.0, "samples": 3 },
    { "key": "lunch", "label": "Lunch hour", "averageDb": 46.8, "peakDb": 54.2, "samples": 12 },
    { "key": "afternoon", "label": "Afternoon", "averageDb": null, "peakDb": null, "samples": 0 },
    { "key": "evening", "label": "Evening", "averageDb": 40.5, "peakDb": 42.5, "samples": 1 }
  ],
  "totalSamples": 16
}
```

#### `400 Bad Request` (Invalid Input):
Returned if the parameters fail validation bounds.
```json
{
  "error": "Decibel reading must be a number between 30 and 90 dB"
}
```

#### `404 Not Found` (Missing Venue):
Returned if the identifier does not match any venue `id` or `placeId` in PostgreSQL.
```json
{
  "error": "Venue not found"
}
```

#### `500 Internal Server Error` (Unexpected failure):
```json
{
  "error": "Internal server error submitting noise metric"
}
```

### 3.4 Ingestion Validation Logic
1. **Range Clamping**: The decibel value must satisfy:
   $$30.0 \le \text{dB} \le 90.0$$
   Vales outside this range are rejected to prevent anomalies (e.g. mic glitches or drops).
2. **Rounding**: Average and peak decibels are rounded to one decimal place:
   $$\text{dB}_{\text{rounded}} = \frac{\lfloor \text{dB} \times 10 + 0.5 \rfloor}{10}$$
3. **Peak Verification**: Enforces that $\text{peakDecibels} \ge \text{avgDecibels}$. If the peak field is missing or lower than the average, it is automatically overridden to equal the average.
4. **User Security Association**:
   * Uses Clerk authentication to identify the user ID.
   * If the user is unauthenticated, it falls back to a special database user `guest-noise-reporter`.
   * An `.upsert()` is performed on the `User` model first to resolve foreign key constraints before writing the rating.

---

## 4. Noise Categorization Boundaries

WorkSphere maintains two classification levels: a client-side layout representation and a database category level.

```
                  Quiet                      Moderate                   Loud
DB Schema:  [------------ 45 dB ------------] [------------ 65 dB ------------] [---------->]
Client UI:  [----------------- 50 dB -----------------] [----------------- 70 dB -------]
```

### 4.1 Server-Side Database Classification
Saves the overall environmental state into the relational database. It is updated upon every telemetry check-in based on the latest average decibel reading:
* **`quiet`**: $< 45\text{ dB}$ (Equivalent to a library or soft whisper).
* **`moderate`**: $45\text{ dB} \le \text{dB} \le 65\text{ dB}$ (Equivalent to soft music or moderate cafe murmur).
* **`loud`**: $> 65\text{ dB}$ (Equivalent to heavy street noise or crowded, loud bars).

### 4.2 Client-Side UI Classification
Calculated on the client to select layout styles, badges, and warning alerts:
* **🍃 Quiet Focus** ($< 50\text{ dB}$): Ideal for high-concentration work. Progress indicator colored **Emerald**.
* **☕ Ambient Cafe** ($50\text{ dB} \le \text{dB} < 70\text{ dB}$): Background conversational sound. Progress indicator colored **Amber**.
* **🔊 Loud Space** ($\ge 70\text{ dB}$): High decibel level, noise-canceling headphones recommended. Progress indicator colored **Rose**.

---

## 5. Temporal Aggregation (Rolling Averages)

Noise telemetry is aggregated dynamically based on the submitter's local timestamp to track how noise levels change throughout the day.

### 5.1 Time-of-Day Buckets
Check-ins are grouped into four temporal windows:
* **Morning**: `00:00 - 10:59` (Hour $< 11$)
* **Lunch hour**: `11:00 - 13:59` (Hour $< 14$)
* **Afternoon**: `14:00 - 17:59` (Hour $< 18$)
* **Evening**: `18:00 - 23:59` (Hour $\ge 18$)

### 5.2 Dynamic Aggregation Formulas
When a GET request is sent to `/api/venues/[venueId]/noise-metrics`, the handler queries all database rating records for that venue and calculates the rolling statistics:

#### Average Decibels
The arithmetic mean of all averages inside the bucket:

$$\mu_{\text{bucket}} = \frac{1}{M}\sum_{i=1}^{M} \text{avgDecibels}_i$$

#### Peak Decibels
The maximum peak recorded within that bucket:

$$\text{Peak}_{\text{bucket}} = \max\left(\text{peakDecibels}_1, \dots, \text{peakDecibels}_M\right)$$

---

## 6. Database Schema Mapping

Telemetry is persisted in the PostgreSQL database using Prisma ORM.

```prisma
model Venue {
  id                  String              @id @default(cuid())
  placeId             String              @unique
  name                String
  latitude            Float
  longitude           Float
  category            String              // cafe, coworking, library
  noiseLevel          String?             // quiet, moderate, loud (aggregated value)
  ratings             VenueRating[]       // Relation back to individual ratings
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
}

model VenueRating {
  id                 String   @id @default(cuid())
  userId             String
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  venueId            String
  venue              Venue    @relation(fields: [venueId], references: [id], onDelete: Cascade)
  noiseLevel         String   // quiet, moderate, loud (individual review)
  avgDecibels        Float?   // average decibels recorded (30.0 - 90.0)
  peakDecibels       Float?   // peak decibels recorded (30.0 - 90.0)
  createdAt          DateTime @default(now())

  @@unique([userId, venueId])
  @@index([venueId])
  @@index([createdAt])
}
```

---

## 7. Multi-Agent AI Recommendation Integration

WorkSphere's recommendation engine integrates noise level data to evaluate, score, and sort venues.

### 7.1 Parameter Extraction
The **Context Agent** parses natural language queries (e.g. *"Show me a quiet cafe to study"*). If the query suggests focus-related intents, the agent sets:
* `workType` $\rightarrow$ `"focus"`
* `amenities` $\rightarrow$ `["quiet"]`

### 7.2 Core Scoring Weights
The **Reasoning Agent** calculates an multi-criteria rating score. Weight distributions are configured dynamically based on the selected `workType`:

| Work Type | WiFi Weight | Noise Weight | Outlets Weight | Rating Weight |
| :--- | :--- | :--- | :--- | :--- |
| **`focus`** | 25% | **35%** (Highest) | 25% | 15% |
| **`calls`** | 40% | **30%** | 15% | 15% |
| **`collaboration`** | 30% | **20%** | 25% | 25% |
| **`casual`** | 25% | **25%** | 25% | 25% |

### 7.3 Decibel Scoring Calculation
A venue's base noise score $S_{\text{noise}}$ is mapped from its database `noiseLevel` category:
* **`quiet`** $\rightarrow$ $9.0$ points
* **`moderate`** $\rightarrow$ $6.0$ points
* **`loud`** $\rightarrow$ $3.0$ points

$$\text{Score}_{\text{base}} = W_{\text{wifi}}S_{\text{wifi}} + W_{\text{noise}}S_{\text{noise}} + W_{\text{outlets}}S_{\text{outlets}} + W_{\text{rating}}S_{\text{rating}}$$

### 7.4 Explicit Preference Bonus
If the user's search context explicitly requests `quiet`, the system awards an additional **bonus of +1.0 points** to any venue whose database category is marked as `quiet` (noiseLevel $< 45\text{dB}$):

$$\text{Score}_{\text{final}} = \min\left(10.0, \text{Score}_{\text{base}} + \text{Bonus}\right)$$

This combined scoring mechanism ensures quiet venues are prioritized for users requiring focus or call workspaces.
