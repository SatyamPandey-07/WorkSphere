// @ts-nocheck
import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface Waypoint {
  id: string;
  name: string;
  bearing: number;
  elevation: number;
  distanceMeters: number;
}

export interface CollimatedHUDOverlayProps {
  waypoints?: Waypoint[];
  accentColor?: string;
  onSessionEnd?: () => void;
}

export const CollimatedHUDOverlay = ({
  waypoints = [],
  accentColor = '#22c55e',
  onSessionEnd,
}: CollimatedHUDOverlayProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [xrSession, setXrSession] = useState<any>(null);
  const [sessionState, setSessionState] = useState<'idle' | 'running' | 'paused' | 'unsupported'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const orientationRef = useRef({
    pitch: 0,
    roll: 0,
  });

  useEffect(() => {
    const nav = typeof window !== 'undefined' ? (window.navigator as any) : null;
    if (nav?.xr?.isSessionSupported) {
      nav.xr
        .isSessionSupported('immersive-ar')
        .then((supported: boolean) => {
          if (!supported) setSessionState('unsupported');
        })
        .catch(() => setSessionState('unsupported'));
    } else {
      setSessionState('unsupported');
    }
  }, []);

  const startXRSession = useCallback(async () => {
    const nav = typeof window !== 'undefined' ? (window.navigator as any) : null;
    if (!nav?.xr) {
      setErrorMsg('WebXR immersive-ar is not supported on this device/browser.');
      return;
    }

    try {
      setErrorMsg(null);
      const session = await nav.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['dom-overlay', 'light-estimation'],
      });

      const handleVisibilityChange = (e: any) => {
        if (e.session?.visibilityState === 'hidden') {
          setSessionState('paused');
        } else {
          setSessionState('running');
        }
      };

      const handleEnd = () => {
        setXrSession(null);
        setSessionState('idle');
        if (onSessionEnd) onSessionEnd();
      };

      session.addEventListener('visibilitychange', handleVisibilityChange);
      session.addEventListener('end', handleEnd);

      setXrSession(session);
      setSessionState('running');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Permission denied or AR session initialization failed.');
      setSessionState('idle');
    }
  }, [onSessionEnd]);

  const endXRSession = useCallback(async () => {
    if (xrSession) {
      await xrSession.end();
      setXrSession(null);
      setSessionState('idle');
    }
  }, [xrSession]);

  const renderHUD = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const { pitch, roll } = orientationRef.current;

      ctx.save();
      ctx.strokeStyle = accentColor;
      ctx.fillStyle = accentColor;
      ctx.lineWidth = 2;
      ctx.font = '14px monospace';

      ctx.translate(cx, cy);
      ctx.rotate((-roll * Math.PI) / 180);

      const pitchPixelScale = 8;
      const pitchOffset = pitch * pitchPixelScale;

      // 1. Central Boresight Crosshair (Infinite optical collimation)
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(-8, 0);
      ctx.moveTo(8, 0);
      ctx.lineTo(16, 0);
      ctx.moveTo(0, -16);
      ctx.lineTo(0, -8);
      ctx.moveTo(0, 8);
      ctx.lineTo(0, 16);
      ctx.stroke();

      // 2. Pitch Ladder Rungs
      const ladderSteps = [-20, -10, 0, 10, 20];
      ladderSteps.forEach((angle) => {
        const y = pitchOffset - angle * pitchPixelScale;
        const rungWidth = angle === 0 ? 90 : 60;

        ctx.beginPath();
        ctx.moveTo(-rungWidth, y);
        ctx.lineTo(-20, y);
        if (angle < 0) {
          ctx.setLineDash([6, 4]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(20, y);
        ctx.lineTo(rungWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillText(`${angle}°`, -rungWidth - 34, y + 4);
        ctx.fillText(`${angle}°`, rungWidth + 8, y + 4);
      });

      // 3. Waypoint Navigation Reticles
      waypoints.forEach((wp: Waypoint) => {
        const wpAngleRad = (wp.bearing * Math.PI) / 180;
        const radius = 140;
        const wpX = Math.sin(wpAngleRad) * radius;
        const wpY = -Math.cos(wpAngleRad) * radius;

        ctx.save();
        ctx.translate(wpX, wpY);
        ctx.rotate(wpAngleRad);

        ctx.beginPath();
        ctx.moveTo(0, -12);
        ctx.lineTo(-8, 8);
        ctx.lineTo(0, 4);
        ctx.lineTo(8, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.fillText(`${wp.name} [${wp.distanceMeters}m]`, wpX + 12, wpY);
      });

      ctx.restore();
    },
    [accentColor, waypoints]
  );

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const loop = () => {
      renderHUD(ctx, canvas.width, canvas.height);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [renderHUD]);

  return (
    <div className="relative w-full h-full min-h-screen bg-transparent overflow-hidden">
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-50 w-full h-full"
      />

      <div className="absolute top-4 left-4 z-50 flex flex-col gap-2 p-3 bg-black/70 backdrop-blur-md border border-emerald-500/30 rounded-lg text-xs font-mono text-emerald-400">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-wider">HUD STATUS:</span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] uppercase ${
              sessionState === 'running'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-yellow-500/20 text-yellow-300'
            }`}
          >
            {sessionState}
          </span>
        </div>

        {errorMsg && <div className="text-red-400 max-w-xs">{errorMsg}</div>}

        <div className="flex gap-2 mt-1">
          {sessionState !== 'running' ? (
            <button
              onClick={startXRSession}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-black font-semibold rounded transition"
            >
              Start WebXR HUD
            </button>
          ) : (
            <button
              onClick={endXRSession}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-semibold rounded transition"
            >
              Exit Session
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CollimatedHUDOverlay;