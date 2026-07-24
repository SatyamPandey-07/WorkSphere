"use client";

import React, { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWebXR } from "../../hooks/useWebXR";
import { useDeskAnchor } from "../../hooks/useDeskAnchor";
import { useArrivalDetection } from "../../hooks/useArrivalDetection";
import { XRSupportChecker } from "../../components/ar/XRSupportChecker";
import { FallbackMap } from "../../components/ar/FallbackMap";
import { DeskOverlay } from "../../components/ar/DeskOverlay";
import { ARScene } from "../../components/ar/ARScene";
import { DirectionArrow } from "../../components/ar/DirectionArrow";
import { Vector3 } from "../../types/ar";

export function ARDeskNavigator() {
  const searchParams = useSearchParams();
  const deskId = searchParams.get("deskId");

  const { requestSession } = useWebXR();
  const {
    anchor,
    loading: anchorLoading,
    error: anchorError,
  } = useDeskAnchor(deskId);

  const [session, setSession] = useState<any>(null);
  const [cameraPos, setCameraPos] = useState<Vector3>({ x: 0, y: 0, z: 0 });
  const [isDone, setIsDone] = useState<boolean>(false);
  const [forceFallback, setForceFallback] = useState<boolean>(false);

  const arrived = useArrivalDetection(cameraPos, anchor?.position, 1.0);

  const startAR = async () => {
    const xrSession = await requestSession();
    if (xrSession) {
      setSession(xrSession);
      xrSession.addEventListener("end", () => {
        setSession(null);
      });
    }
  };

  if (!deskId) {
    return (
      <div className="p-8 text-center bg-white min-h-screen text-black">
        <h1 className="text-2xl font-bold mb-4">Workspace AR Navigation</h1>
        <p>
          Please provide a deskId in the URL (e.g., ?deskId=123) to navigate to
          a desk.
        </p>
      </div>
    );
  }

  if (anchorLoading) {
    return (
      <div className="p-8 text-center bg-white min-h-screen text-black flex items-center justify-center">
        Loading desk anchor...
      </div>
    );
  }

  if (anchorError) {
    return (
      <div className="p-8 text-center bg-white min-h-screen text-red-500 flex items-center justify-center">
        Error: {anchorError}
      </div>
    );
  }

  if (isDone) {
    return (
      <div className="p-8 text-center bg-white min-h-screen text-black flex flex-col items-center justify-center">
        <div className="text-4xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold mb-2">You have arrived!</h1>
        <p>Have a great time at Desk {anchor?.deskNumber}.</p>
      </div>
    );
  }

  if (forceFallback) {
    return (
      <FallbackMap userPosition={cameraPos} deskPosition={anchor?.position} />
    );
  }

  return (
    <XRSupportChecker
      fallback={
        <FallbackMap userPosition={cameraPos} deskPosition={anchor?.position} />
      }
    >
      <div className="relative w-full h-screen bg-black overflow-hidden font-sans">
        {!session ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white text-black z-20 p-4">
            <h1 className="text-3xl font-bold mb-4 text-center">
              AR Workspace Navigator
            </h1>
            <p className="mb-8 text-gray-600 text-center max-w-md">
              Use your camera to find your way to Desk {anchor?.deskNumber}.
              Please grant camera permissions when prompted.
            </p>
            <button
              onClick={startAR}
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-lg shadow-lg transition-transform hover:scale-105 cursor-pointer"
            >
              Start AR Navigation
            </button>
            <div className="mt-8">
              <button
                onClick={() => setForceFallback(true)}
                className="text-gray-400 underline cursor-pointer hover:text-gray-600"
              >
                View 2D Map Instead
              </button>
            </div>
          </div>
        ) : (
          <>
            <ARScene session={session} onCameraMove={setCameraPos}>
              {anchor && (
                <DirectionArrow from={cameraPos} to={anchor.position} />
              )}
            </ARScene>

            <div className="absolute top-0 left-0 right-0 p-6 z-20 pointer-events-none flex justify-between items-start">
              <div className="bg-white/90 backdrop-blur-md rounded-2xl px-6 py-4 shadow-xl text-black">
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Target Desk
                </p>
                <p className="text-2xl font-black">{anchor?.deskNumber}</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await session.end();
                  } catch {}
                  setSession(null);
                }}
                className="bg-red-500/90 hover:bg-red-600 text-white w-12 h-12 rounded-full shadow-lg flex items-center justify-center pointer-events-auto cursor-pointer transition-colors"
                aria-label="Exit AR"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {arrived && (
              <div className="pointer-events-auto z-30 relative">
                <DeskOverlay
                  deskNumber={anchor?.deskNumber || ""}
                  onDone={() => {
                    setIsDone(true);
                    try {
                      if (session) session.end();
                    } catch {}
                    setSession(null);
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </XRSupportChecker>
  );
}
