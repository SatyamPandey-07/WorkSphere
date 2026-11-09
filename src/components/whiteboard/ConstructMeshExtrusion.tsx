import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface Point2D {
  x: number;
  y: number;
}

export interface Transform3D {
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scale: number;
  positionX: number;
  positionY: number;
  positionZ: number;
}

export interface ConstructMeshExtrusionProps {
  strokePoints?: Point2D[];
  extrusionDepth?: number;
  emissiveColor?: string;
  wireframeColor?: string;
  roomId?: string;
  partykitHost?: string;
  onTransformChange?: (transform: Transform3D) => void;
}

const DEFAULT_TRANSFORM: Transform3D = {
  rotationX: 15,
  rotationY: 30,
  rotationZ: 0,
  scale: 1,
  positionX: 0,
  positionY: 0,
  positionZ: 0,
};

const sanitizeTransform = (t: Partial<Transform3D>, fallback: Transform3D): Transform3D => ({
  rotationX: typeof t.rotationX === 'number' && Number.isFinite(t.rotationX) ? t.rotationX : fallback.rotationX,
  rotationY: typeof t.rotationY === 'number' && Number.isFinite(t.rotationY) ? t.rotationY : fallback.rotationY,
  rotationZ: typeof t.rotationZ === 'number' && Number.isFinite(t.rotationZ) ? t.rotationZ : fallback.rotationZ,
  scale: typeof t.scale === 'number' && Number.isFinite(t.scale) && t.scale > 0 ? t.scale : fallback.scale,
  positionX: typeof t.positionX === 'number' && Number.isFinite(t.positionX) ? t.positionX : fallback.positionX,
  positionY: typeof t.positionY === 'number' && Number.isFinite(t.positionY) ? t.positionY : fallback.positionY,
  positionZ: typeof t.positionZ === 'number' && Number.isFinite(t.positionZ) ? t.positionZ : fallback.positionZ,
});

export const ConstructMeshExtrusion: React.FC<ConstructMeshExtrusionProps> = ({
  strokePoints = [],
  extrusionDepth = 24,
  emissiveColor = '#10b981',
  wireframeColor = '#34d399',
  roomId = 'default-room',
  partykitHost,
  onTransformChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [transform, setTransform] = useState<Transform3D>(DEFAULT_TRANSFORM);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'connected' | 'disconnected'>('idle');

  // PartyKit Real-time Sync Lifecycle
  useEffect(() => {
    if (!partykitHost || !roomId) {
      setSyncStatus('idle');
      return;
    }

    let isMounted = true;
    let socket: WebSocket | null = null;

    try {
      const protocol = partykitHost.startsWith('localhost') ? 'ws' : 'wss';
      socket = new WebSocket(`${protocol}://${partykitHost}/parties/whiteboard/${roomId}`);

      socket.onopen = () => {
        if (!isMounted) return;
        setSyncStatus('connected');
        try {
          socket?.send(JSON.stringify({ type: 'join', payload: { client: 'mesh-extruder' } }));
        } catch {
          // ignore send error
        }
      };

      socket.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const data = JSON.parse(event.data);
          if (data && data.type === 'sync-transform' && typeof data.payload === 'object' && data.payload !== null) {
            setTransform((prev) => {
              const sanitized = sanitizeTransform(data.payload, prev);
              if (onTransformChange) onTransformChange(sanitized);
              return sanitized;
            });
          }
        } catch {
          // ignore parsing error
        }
      };

      socket.onerror = () => {
        if (isMounted) setSyncStatus('disconnected');
      };
      socket.onclose = () => {
        if (isMounted) setSyncStatus('disconnected');
      };
    } catch {
      if (isMounted) setSyncStatus('disconnected');
    }

    return () => {
      isMounted = false;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // ignore socket close errors during teardown
        }
      }
    };
  }, [partykitHost, roomId, onTransformChange]);

  const updateTransform = useCallback(
    (newTransform: Partial<Transform3D>) => {
      setTransform((prev) => {
        const updated = sanitizeTransform(newTransform, prev);
        if (onTransformChange) onTransformChange(updated);
        return updated;
      });
    },
    [onTransformChange]
  );

  const renderMesh = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2 + (Number.isFinite(transform.positionX) ? transform.positionX : 0);
      const cy = height / 2 + (Number.isFinite(transform.positionY) ? transform.positionY : 0);

      ctx.save();
      ctx.translate(cx, cy);

      const radX = ((transform.rotationX || 0) * Math.PI) / 180;
      const radY = ((transform.rotationY || 0) * Math.PI) / 180;
      const safeScale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;

      const project = (x: number, y: number, z: number) => {
        const cosY = Math.cos(radY);
        const sinY = Math.sin(radY);
        const cosX = Math.cos(radX);
        const sinX = Math.sin(radX);

        const rotX = x * cosY + z * sinY;
        const rotZ = -x * sinY + z * cosY;
        const rotY = y * cosX - rotZ * sinX;

        const px = rotX * safeScale;
        const py = rotY * safeScale;

        return {
          px: Number.isFinite(px) ? px : 0,
          py: Number.isFinite(py) ? py : 0,
        };
      };

      const safeDepth =
        typeof extrusionDepth === 'number' && Number.isFinite(extrusionDepth) && extrusionDepth > 0
          ? extrusionDepth
          : 24;

      const validPoints: Point2D[] = Array.isArray(strokePoints)
        ? strokePoints.filter(
            (p): p is Point2D =>
              p !== null &&
              typeof p === 'object' &&
              typeof p.x === 'number' &&
              Number.isFinite(p.x) &&
              typeof p.y === 'number' &&
              Number.isFinite(p.y)
          )
        : [];

      const points =
        validPoints.length >= 3
          ? validPoints
          : [
              { x: -50, y: -50 },
              { x: 50, y: -50 },
              { x: 70, y: 50 },
              { x: -70, y: 50 },
            ];

      const frontFace = points.map((p) => project(p.x, p.y, -safeDepth / 2));
      const backFace = points.map((p) => project(p.x, p.y, safeDepth / 2));

      // 1. Emissive Solid Fill
      ctx.fillStyle = emissiveColor;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      frontFace.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.px, pt.py);
        else ctx.lineTo(pt.px, pt.py);
      });
      ctx.closePath();
      ctx.fill();

      // 2. Extruded Side Prisms
      ctx.fillStyle = emissiveColor;
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < points.length; i++) {
        const next = (i + 1) % points.length;
        ctx.beginPath();
        ctx.moveTo(frontFace[i].px, frontFace[i].py);
        ctx.lineTo(frontFace[next].px, frontFace[next].py);
        ctx.lineTo(backFace[next].px, backFace[next].py);
        ctx.lineTo(backFace[i].px, backFace[i].py);
        ctx.closePath();
        ctx.fill();
      }

      // 3. Emerald Wireframe Cage Lines
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = wireframeColor;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = emissiveColor;
      ctx.shadowBlur = 8;

      ctx.beginPath();
      frontFace.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.px, pt.py);
        else ctx.lineTo(pt.px, pt.py);
      });
      ctx.closePath();
      ctx.stroke();

      ctx.beginPath();
      backFace.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.px, pt.py);
        else ctx.lineTo(pt.px, pt.py);
      });
      ctx.closePath();
      ctx.stroke();

      for (let i = 0; i < points.length; i++) {
        ctx.beginPath();
        ctx.moveTo(frontFace[i].px, frontFace[i].py);
        ctx.lineTo(backFace[i].px, backFace[i].py);
        ctx.stroke();
      }

      ctx.restore();
    },
    [strokePoints, extrusionDepth, emissiveColor, wireframeColor, transform]
  );

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const handleResize = () => {
      canvas.width = canvas.parentElement?.clientWidth || 400;
      canvas.height = canvas.parentElement?.clientHeight || 400;
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const loop = () => {
      renderMesh(ctx, canvas.width, canvas.height);
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [renderMesh]);

  const activePointsCount = Array.isArray(strokePoints) ? strokePoints.length : 0;

  return (
    <div className="relative w-full h-full min-h-96 flex items-center justify-center bg-black/40 rounded-xl overflow-hidden border border-emerald-950/40">
      <canvas ref={canvasRef} data-testid="mesh-canvas" className="w-full h-full cursor-grab active:cursor-grabbing" />

      <div className="absolute bottom-3 left-3 flex flex-col gap-1 p-2.5 rounded-lg bg-black/80 border border-emerald-500/20 text-[11px] font-mono text-emerald-300">
        <div className="flex items-center gap-2">
          <span>MESH EXTRUSION:</span>
          <span className="text-emerald-400 font-bold">{activePointsCount || 4} PTS</span>
          <span data-testid="sync-status" className="text-xs text-emerald-500/80">({syncStatus})</span>
        </div>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => updateTransform({ rotationY: transform.rotationY + 15 })}
            className="px-2 py-0.5 bg-emerald-900/60 hover:bg-emerald-700/60 border border-emerald-500/30 rounded text-emerald-200"
          >
            Rotate Y
          </button>
          <button
            onClick={() => updateTransform({ rotationX: transform.rotationX + 15 })}
            className="px-2 py-0.5 bg-emerald-900/60 hover:bg-emerald-700/60 border border-emerald-500/30 rounded text-emerald-200"
          >
            Rotate X
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConstructMeshExtrusion;
