# Open Graph Metadata & Dynamic Image Generation Guide

This guide explains how to generate dynamic Open Graph (OG) images using `@vercel/og` (ImageResponse) in the Next.js App Router, specifically tailored for venue sharing.
---

## 1. Dynamic Image Templates

In the Next.js App Router, you can create dynamic OG images by adding an `opengraph-image.tsx` file within a dynamic route segment (e.g., `app/venues/[id]/opengraph-image.tsx`).
Here is a standard template for a venue share card:

```tsx
import { ImageResponse } from "next/og";
// Route segment config
export const runtime = "edge";
// Image metadata
export const alt = "Venue Share Image";
export const size = {
  width: 1200,
  height: 630,
};
export default async function Image({ params }: { params: { id: string } }) {
  // Fetch venue data based on params.id here
  const venueName = "Sample Venue Name";
  const venueLocation = "City, Country";
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: "#1e293b",
        color: "white",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ fontSize: 64, fontWeight: "bold", margin: "0 0 20px 0" }}>
        {venueName}
      </h1>
      <p style={{ fontSize: 32, color: "#94a3b8" }}>📍 {venueLocation}</p>
    </div>,
    { ...size },
  );
}
```
