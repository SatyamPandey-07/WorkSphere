"use client";

import { useState } from "react";
import { useWebXR } from "@/hooks/useWebXR";
import ARNavigation from "./ARNavigation";
import CompassFallback from "./CompassFallback";
import { View } from "lucide-react";

export default function NavigationContainer() {
  const { isSupported, requestSession } = useWebXR();
  const [session, setSession] = useState<XRSession | null>(null);
  const [useFallback, setUseFallback] = useState(false);

  const startAR = async () => {
    const newSession = await requestSession();
    if (newSession) {
      newSession.addEventListener("end", () => {
        setSession(null);
      });
      setSession(newSession);
    } else {
      // Fallback if request fails
      setUseFallback(true);
    }
  };

  if (session) {
    return (
      <ARNavigation session={session} onEndSession={() => session.end()} />
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

      <h2 className="text-2xl font-bold mb-3">AR Navigation</h2>
      <p className="text-slate-400 text-center max-w-md mb-8">
        Navigate indoors using your camera. We will place 3D directional arrows
        in the real world to guide you to your destination.
      </p>

      {isSupported === null ? (
        <div className="animate-pulse text-slate-500">
          Checking device compatibility...
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
    </div>
  );
}
