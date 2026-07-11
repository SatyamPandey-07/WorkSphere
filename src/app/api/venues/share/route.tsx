import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const venueId = request.nextUrl.searchParams.get("venueId");

  if (!venueId) {
    return new Response("venueId is required", { status: 400 });
  }

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
  });

  if (!venue) {
    return new Response("Venue not found", { status: 404 });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          position: "relative",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px",
          color: "white",
          background:
            "radial-gradient(circle at top right, #6d28d9 0%, #111827 38%, #030712 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <div
            style={{
              width: "52px",
              height: "52px",
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#8b5cf6",
              fontSize: "28px",
            }}
          >
            W
          </div>
          <div style={{ fontSize: "28px", color: "#c4b5fd" }}>WorkSphere</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
          <div
            style={{
              fontSize: "70px",
              fontWeight: 800,
              maxWidth: "940px",
              letterSpacing: "-2px",
              lineHeight: 1.05,
            }}
          >
            {venue.name}
          </div>

          <div style={{ fontSize: "30px", color: "#d1d5db" }}>
            {venue.address || "A workspace worth sharing"}
          </div>

          <div style={{ display: "flex", gap: "18px", fontSize: "24px" }}>
            <span
              style={{
                padding: "12px 20px",
                borderRadius: "999px",
                background: "rgba(139, 92, 246, 0.22)",
                border: "1px solid rgba(196, 181, 253, 0.35)",
              }}
            >
              {venue.category}
            </span>

            {venue.rating ? (
              <span
                style={{
                  padding: "12px 20px",
                  borderRadius: "999px",
                  background: "rgba(250, 204, 21, 0.16)",
                }}
              >
                ★ {venue.rating.toFixed(1)}
              </span>
            ) : null}

            {venue.wifiQuality ? (
              <span
                style={{
                  padding: "12px 20px",
                  borderRadius: "999px",
                  background: "rgba(34, 211, 238, 0.14)",
                }}
              >
                WiFi {venue.wifiQuality}/5
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ fontSize: "24px", color: "#9ca3af" }}>
          Discover better places to work together.
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
