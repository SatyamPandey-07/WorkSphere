"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorUp, PictureInPicture2, Square, Crop, Signal } from "lucide-react";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useScreenShareQuality } from "@/hooks/useScreenShareQuality";
import { DataSaverToggle } from "@/components/sessions/DataSaverToggle";

type Props = {
  sessionSlug: string;
  hostId: string;
  currentUserId: string | null | undefined;
};

export default function ScreenSharePanel({
  sessionSlug,
  hostId,
  currentUserId,
}: Props) {
  const isHost = !!currentUserId && currentUserId === hostId;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pipOn, setPipOn] = useState(false);

  const {
    sharing,
    localStream,
    remoteStream,
    sender, // Exposed from useScreenShare to pass to quality hook
    error,
    pipSupported,
    dataSaverMode,
    startShare,
    stopShare,
    setDataSaverMode,
    requestPip,
  } = useScreenShare({
    roomId: `session-${sessionSlug}`,
    userId: currentUserId,
    isHost,
  });

  // Initialize Quality Control Hook if we have a sender (usually the host)
  const { currentProfile, manualSetProfile } = useScreenShareQuality(sender || null);

  const activeStream = isHost ? localStream : remoteStream;
  const showStage = !!activeStream;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = activeStream;
  }, [activeStream]);

  useEffect(() => {
    function onLeave() {
      setPipOn(false);
    }
    document.addEventListener("leavepictureinpicture", onLeave);
    return () => document.removeEventListener("leavepictureinpicture", onLeave);
  }, []);

  const handleTogglePiP = async () => {
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setPipOn(false);
      } else if (videoRef.current.requestPictureInPicture) {
        await videoRef.current.requestPictureInPicture();
        setPipOn(true);
      }
    } catch (error) {
      console.error('Picture-in-Picture failed:', error);
    }
  };

  const handleCropRegion = async () => {
    // Note: Region Capture API (CropTarget) requires specific browser support and setup.
    // This is a scaffold for the feature.
    console.log('Region capture initiated. Implement CropTarget.fromElement() here.');
  };

  if (!currentUserId) {
    return null;
  }

  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-black/25 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">
            Live presentation
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            {isHost
              ? "Share your screen with everyone in this session."
              : sharing || remoteStream
                ? "Host is presenting — open PiP to keep watching while you work."
                : "Waiting for the host to share their screen."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {isHost && !sharing && (
            <button
              type="button"
              onClick={() => void startShare()}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500"
            >
              <MonitorUp className="h-4 w-4" />
              Share screen
            </button>
          )}
          {isHost && sharing && (
            <>
              <DataSaverToggle
                enabled={dataSaverMode}
                onChange={(enabled) => void setDataSaverMode(enabled)}
              />
              <button
                type="button"
                onClick={stopShare}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
              >
                <Square className="h-4 w-4" />
                Stop sharing
              </button>
            </>
          )}
          {showStage && pipSupported && (
            <button
              type="button"
              onClick={handleTogglePiP}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              <PictureInPicture2 className="h-4 w-4" />
              {pipOn ? "Exit PiP" : "Pop out"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}

      {showStage && (
        <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isHost}
            className="w-full h-full object-contain"
          />

          {/* Overlay Controls for Quality & Region Capture */}
          {sharing && (
            <div className="absolute top-4 left-4 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {/* Quality Profile Selector */}
              <div className="relative">
                <select
                  value={currentProfile}
                  onChange={(e) => manualSetProfile(e.target.value)}
                  className="appearance-none pl-9 pr-8 py-1.5 text-xs font-medium bg-black/60 text-white rounded-lg border border-white/10 backdrop-blur-md hover:bg-black/80 transition-colors cursor-pointer outline-none focus:border-cyan-500"
                >
                  <option value="4k">4K (High Bandwidth)</option>
                  <option value="1080p">1080p (Balanced)</option>
                  <option value="720p">720p (Constrained)</option>
                  <option value="480p">480p (Low Bandwidth)</option>
                </select>
                <Signal className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400 pointer-events-none" />
              </div>

              {/* Region Capture Button */}
              <button
                onClick={handleCropRegion}
                title="Crop to Region (Experimental)"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-black/60 text-white rounded-lg border border-white/10 backdrop-blur-md hover:bg-black/80 transition-colors"
              >
                <Crop className="h-3.5 w-3.5" />
                <span>Crop</span>
              </button>
            </div>
          )}

          {/* Close/Stop Button Overlay for Viewers or Hosts */}
          {!isHost && (
            <button
              onClick={() => { /* Maybe just hide stage? Or leave session? */ }}
              className="absolute bottom-4 right-4 px-4 py-2 bg-black/60 backdrop-blur-md text-white text-xs font-medium rounded-lg border border-white/10 hover:bg-red-600/80 hover:border-red-500/50 transition-colors"
            >
              Hide Stage
            </button>
          )}
        </div>
      )}
    </div>
  );
}
