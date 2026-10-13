"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * TacticalTargetReticle — interactive target-locking overlay for hovered venue
 * cards (desktop viewports only).
 *
 *  1. 60fps canvas loop drawing rotating segmented locking brackets [ 🎯 ]
 *     around the hovered card's bounding box.
 *  2. Bounding box measured live on hover; spring-eased interpolation when
 *     shifting focus between cards, plus a simulated distance rangefinder readout.
 *  3. Subtle Web Audio locking-tone beep when the lock engages (two short
 *     oscillator chirps). All nodes disconnected after each chirp.
 *  4. Canvas sits in a fixed `pointer-events: none` overlay — clicks, links and
 *     buttons under it are never blocked.
 */

const BRACKET_SEGMENTS = 4; // corner brackets
const BRACKET_LENGTH = 22; // px per bracket arm
const ROTATION_SPEED = 0.9; // rad/s
const SPRING_STIFFNESS = 180;
const SPRING_DAMPING = 22;
const LOCK_RANGE_KM = 4.2; // simulated rangefinder reference

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Spring integration step (semi-implicit Euler). */
function stepSpring(
  pos: number,
  vel: number,
  target: number,
  dt: number,
): [number, number] {
  const accel = (target - pos) * SPRING_STIFFNESS - vel * SPRING_DAMPING;
  const newVel = vel + accel * dt;
  const newPos = pos + newVel * dt;
  return [newPos, newVel];
}

export interface TacticalTargetReticleProps {
  /** Convention: any child may set `data-reticle-target` to opt into tracking. */
  children: ReactNode;
  /** Lock tone frequency in Hz (default 880). */
  toneFrequency?: number;
  /** Whether the lock tone should play (default true; suppressed for a11y). */
  soundEnabled?: boolean;
}

export function TacticalTargetReticle({
  children,
  toneFrequency = 880,
  soundEnabled = true,
}: TacticalTargetReticleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const activeNodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const lastBeepTimeRef = useRef(0);

  // Current animated rect (spring) + velocity + target rect, all in refs so the
  // animation loop never causes React re-renders.
  const rectRef = useRef<Rect | null>(null);
  const velRef = useRef<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const targetRef = useRef<Rect | null>(null);
  const hoveredElRef = useRef<HTMLElement | null>(null);
  const [hoverActive, setHoverActive] = useState(false);
  const [rangeKm, setRangeKm] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  // Desktop viewport gate (<1024px wide or touch-primary → no reticle).
  useEffect(() => {
    const check = () =>
      setIsDesktop(window.matchMedia("(hover: hover) and (pointer: fine)").matches && window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const readRect = useCallback((el: HTMLElement): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }, []);

  // Hover delegation: find the closest `[data-reticle-target]` under the pointer.
  useEffect(() => {
    if (!isDesktop) return;
    const container = containerRef.current;
    if (!container) return;

    const onPointerMove = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-reticle-target]",
      );
      if (el && el !== hoveredElRef.current) {
        hoveredElRef.current = el;
        targetRef.current = readRect(el);
        if (!rectRef.current) rectRef.current = targetRef.current;
        setHoverActive(true);
        // Simulated rangefinder readout: distance derived from element's data
        // attribute when present, else pseudo-random from its index position.
        const raw = el.getAttribute("data-reticle-range");
        const parsed = raw ? parseFloat(raw) : NaN;
        setRangeKm(
          Number.isFinite(parsed)
            ? parsed
            : Math.round((0.4 + ((el.offsetTop * 7919) % 3800) / 1000) * 10) / 10,
        );
      } else if (!el && hoveredElRef.current) {
        hoveredElRef.current = null;
        targetRef.current = null;
        setHoverActive(false);
      } else if (el) {
        // Track scroll/size changes of the already-hovered card.
        targetRef.current = readRect(el);
      }
    };

    container.addEventListener("mousemove", onPointerMove, { passive: true });
    return () => {
      container.removeEventListener("mousemove", onPointerMove);
    };
  }, [isDesktop, readRect]);

  // Web Audio lock tone: two quick chirps, then full node teardown.
  const playLockTone = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return;

      let ctx = ctxRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioCtor();
        ctxRef.current = ctx;
      }
      if (ctx.state === "suspended") void ctx.resume();

      const t0 = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.connect(ctx.destination);

      const chirp = (start: number, freq: number, dur: number) => {
        const osc = ctx!.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + dur);
        activeNodesRef.current.push(osc);
      };

      // Double chirp: rising confirmation, characteristic "lock" signature.
      chirp(t0, toneFrequency, 0.06);
      chirp(t0 + 0.09, toneFrequency * 1.5, 0.09);

      gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.1, t0 + 0.09);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);

      // Full teardown after the final chirp decays.
      const sources = [...activeNodesRef.current];
      window.setTimeout(() => {
        for (const node of sources) {
          try {
            node.disconnect();
          } catch {
            /* already disconnected */
          }
        }
        gain.disconnect();
        activeNodesRef.current = [];
      }, 450);
    } catch {
      /* audio unavailable — silently skip */
    }
  }, [soundEnabled, toneFrequency]);

  // Canvas animation loop: spring interpolation + rotating segmented brackets.
  useEffect(() => {
    if (!isDesktop) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      rafRef.current = null;
      const dt = Math.min((now - (loopLastRef.current || now)) / 1000, 0.05);
      loopLastRef.current = now;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const rect = rectRef.current;
      const target = targetRef.current;
      const active = rect && target && hoveredElRef.current;

      if (rect && target) {
        // Spring-ease all four rect channels toward the target.
        const [x, vx] = stepSpring(rect.x, velRef.current.x, target.x, dt);
        const [y, vy] = stepSpring(rect.y, velRef.current.y, target.y, dt);
        const [w, vw] = stepSpring(rect.w, velRef.current.w, target.w, dt);
        const [h, vh] = stepSpring(rect.h, velRef.current.h, target.h, dt);
        rectRef.current = { x, y, w, h };
        velRef.current = { x: vx, y: vy, w: vw, h: vh };

        // Rotating segmented corner brackets.
        const rotation = now * ROTATION_SPEED * 0.001;
        const pad = 6;
        const bx = x - pad;
        const by = y - pad;
        const bw = w + pad * 2;
        const bh = h + pad * 2;
        const phase = active ? 1 : 0;

        ctx.save();
        ctx.strokeStyle = `rgba(52, 211, 153, ${0.75 + 0.2 * Math.sin(now * 0.008) * phase})`;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(52, 211, 153, 0.8)";
        ctx.shadowBlur = 6;

        // Segments: 4 corner brackets that slowly orbit the card bounds.
        const corners: Array<[number, number, number, number]> = [
          [bx, by, 1, 1], // top-left
          [bx + bw, by, -1, 1], // top-right
          [bx + bw, by + bh, -1, -1], // bottom-right
          [bx, by + bh, 1, -1], // bottom-left
        ];
        for (let i = 0; i < BRACKET_SEGMENTS; i++) {
          const [cx, cy, sx, sy] = corners[i];
          // Orbit offset via rotation — brackets slide along the perimeter.
          const travel = ((rotation + (i * Math.PI) / 2) % (Math.PI * 2)) / (Math.PI * 2);
          const perim = 2 * (bw + bh);
          let d = travel * perim;
          // Walk the perimeter to find the bracket anchor point.
          let ax: number, ay: number, dirX = 0, dirY = 0;
          if (d < bw) {
            ax = bx + d; ay = by; dirX = 1;
          } else if ((d -= bw) < bh) {
            ax = bx + bw; ay = by + d; dirY = 1;
          } else if ((d -= bh) < bw) {
            ax = bx + bw - d; ay = by + bh; dirX = -1;
          } else {
            d -= bw; ax = bx; ay = by + bh - d; dirY = -1;
          }
          void cx; void cy; void sx; void sy; // corners reserved for future styling
          ctx.beginPath();
          ctx.moveTo(ax + dirX * BRACKET_LENGTH, ay + dirY * BRACKET_LENGTH);
          ctx.lineTo(ax, ay);
          ctx.lineTo(ax - dirX * BRACKET_LENGTH * 0.4, ay - dirY * BRACKET_LENGTH * 0.4);
          ctx.stroke();
        }

        // Center reticle dot when locked.
        if (phase > 0) {
          const ccx = bx + bw / 2;
          const ccy = by + bh / 2;
          ctx.beginPath();
          ctx.arc(ccx, ccy, 3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
          ctx.fill();
        }
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    const loopLastRef = { current: 0 };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isDesktop]);

  // Beep once when lock first engages (throttled ≥400ms).
  useEffect(() => {
    if (!hoverActive) return;
    const now = performance.now();
    if (now - lastBeepTimeRef.current < 400) return;
    lastBeepTimeRef.current = now;
    playLockTone();
  }, [hoverActive, playLockTone]);

  // Unmount: cancel loop, close audio context, disconnect residual nodes.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      for (const node of activeNodesRef.current) {
        try {
          node.disconnect();
        } catch {
          /* noop */
        }
      }
      activeNodesRef.current = [];
      ctxRef.current?.close().catch(() => { });
      ctxRef.current = null;
    };
  }, []);

  const overlayStyle: CSSProperties = useMemo(
    () => ({
      position: "fixed",
      inset: 0,
      pointerEvents: "none", // zero impact on card clickability
      zIndex: 60,
      opacity: hoverActive ? 1 : 0,
      transition: "opacity 150ms ease",
    }),
    [hoverActive],
  );

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      {children}
      {isDesktop && (
        <div style={overlayStyle} aria-hidden="true">
          <canvas ref={canvasRef} />
          {/* Simulated distance rangefinder readout, positioned near the card */}
          {hoverActive && rangeKm !== null && rectRef.current && (
            <div
              style={{
                position: "fixed",
                left: rectRef.current.x + rectRef.current.w / 2 - 40,
                top: rectRef.current.y - 34,
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "rgba(52, 211, 153, 0.95)",
                textShadow: "0 0 6px rgba(52, 211, 153, 0.5)",
                userSelect: "none",
              }}
            >
              RNG {rangeKm.toFixed(1)} KM
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TacticalTargetReticle;
