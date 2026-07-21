"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorUp, PictureInPicture2, Square } from "lucide-react";
import { useScreenShare } from "@/hooks/useScreenShare";

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
    error,
    pipSupported,
    startShare,
    stopShare,
    requestPip,
  } = useScreenShare({
    roomId: `session-${sessionSlug}`,
    userId: currentUserId,
    isHost,
  });

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

  if (!currentUserId) {
    return null;
  }

  return (
    <div className="mt-8 rounded-2xl border border-white/10 bg-black/25 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
            <button
              type="button"
              onClick={stopShare}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium hover:bg-white/10"
            >
              <Square className="h-4 w-4" />
              Stop sharing
            </button>
          )}
          {showStage && pipSupported && (
            <button
              type="button"
              onClick={async () => {
                const on = await requestPip(videoRef.current);
                setPipOn(on);
              }}
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
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isHost}
          className="mt-4 aspect-video w-full rounded-xl bg-black object-contain"
        />
      )}
    </div>
  );
}
