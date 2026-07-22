"use client";

import { useState, useEffect, useCallback } from "react";
import { useWebXR } from "@/hooks/useWebXR";
import ARNavigation from "./ARNavigation";
import CompassFallback from "./CompassFallback";
import { View } from "lucide-react";

interface SeatData {
  id: string;
  seatNumber: string;
  type: string;
  x: number;
  y: number;
}

interface AnchorData {
  id: string;
  anchorPersistId: string;
  seatId: string | null;
  bookingId: string | null;
  matrix: number[];
  label: string | null;
  seat: { id: string; seatNumber: string; type: string } | null;
}

interface NavigationContainerProps {
  venueId: string;
}

export default function NavigationContainer({
  venueId,
}: NavigationContainerProps) {
  const { isSupported, requestSession } = useWebXR();
  const [session, setSession] = useState<XRSession | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [seats, setSeats] = useState<SeatData[]>([]);
  const [anchors, setAnchors] = useState<AnchorData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const dateStr = now.toISOString().slice(0, 10);
        const [seatsRes, anchorsRes] = await Promise.all([
          fetch(
            `/api/reservations/availability?venueId=${venueId}&date=${dateStr}&time=${timeStr}&duration=60`,
          ),
          fetch(`/api/ar/anchors?venueId=${venueId}`),
        ]);

        if (!cancelled && seatsRes.ok) {
          const seatsData = await seatsRes.json();
          setSeats(seatsData.seats ?? []);
        }

        if (!cancelled && anchorsRes.ok) {
          const anchorsData = await anchorsRes.json();
          setAnchors(anchorsData.data ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch venue data for AR:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [venueId]);

  const handleSaveAnchor = useCallback(
    async (data: {
      anchorPersistId: string;
      seatId: string | null;
      bookingId: string | null;
      matrix: number[];
      label: string | null;
    }) => {
      try {
        const res = await fetch("/api/ar/anchors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueId, ...data }),
        });
        if (res.ok) {
          const { data: anchor } = await res.json();
          setAnchors((prev) => [anchor, ...prev]);
        }
      } catch (err) {
        console.error("Failed to save anchor:", err);
      }
    },
    [venueId],
  );

  const handleDeleteAnchor = useCallback(async (anchorDbId: string) => {
    try {
      const res = await fetch(`/api/ar/anchors/${anchorDbId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAnchors((prev) => prev.filter((a) => a.id !== anchorDbId));
      }
    } catch (err) {
      console.error("Failed to delete anchor:", err);
    }
  }, []);

  const startAR = async () => {
    const newSession = await requestSession();
    if (newSession) {
      newSession.addEventListener("end", () => {
        setSession(null);
      });
      setSession(newSession);
    } else {
      setUseFallback(true);
    }
  };

  if (session) {
    return (
      <ARNavigation
        session={session}
        onEndSession={() => session.end()}
        venueId={venueId}
        seats={seats}
        anchors={anchors}
        onSaveAnchor={handleSaveAnchor}
        onDeleteAnchor={handleDeleteAnchor}
      />
    );
  }

  if (useFallback || isSupported === false) {
    return <CompassFallback />;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] w-full bg-slate-900 rounded-lg p-6 text-white border border-slate-800">
      <div className="bg-blue-500/20 p-4 rounded-full mb-6">
        <View className="w-12 h-12 text-blue-400" />
      </div>

      <h2 className="text-2xl font-bold mb-3">AR Desk Finder</h2>
      <p className="text-slate-400 text-center max-w-md mb-8">
        View reserved desks anchored in real space. Tap any desk to pin a
        persistent marker that survives across sessions.
      </p>

      {isSupported === null || loading ? (
        <div className="animate-pulse text-slate-500">
          {loading
            ? "Loading venue data..."
            : "Checking device compatibility..."}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={startAR}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-md font-medium transition-colors shadow-lg shadow-blue-500/20"
          >
            Start AR Session
          </button>
          <button
            onClick={() => setUseFallback(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-8 py-3 rounded-md font-medium transition-colors border border-slate-700"
          >
            Use 2D Map
          </button>
        </div>
      )}

      {anchors.length > 0 && (
        <div className="mt-6 text-sm text-slate-500">
          {anchors.length} anchor{anchors.length !== 1 ? "s" : ""} saved for
          this venue
        </div>
      )}
    </div>
  );
}
