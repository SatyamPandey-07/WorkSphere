import { normalizeAngle } from "@/lib/geometry/bearing";

export interface RadarDrawOptions {
  /** Size in pixels of square radar canvas (e.g. 120 or 140) */
  size?: number;
  /** Radius in meters of the outer radar ring */
  maxRangeMeters?: number;
  /** Heading of device compass in degrees [0, 360) */
  heading?: number | null;
  /** Angle towards target in degrees [0, 360) in world coordinates */
  bearingAngle?: number;
  /** Horizontal distance to target in meters */
  distance?: number;
  /** Animation timestamp in milliseconds or seconds */
  pulseTime?: number;
  /** Custom seat label (e.g. "1A") */
  seatLabel?: string;
}

/**
 * Draws a circular top-down 2D radar mini-map overlay onto a HTMLCanvasElement.
 * Displays:
 * - Circular HUD background with range concentric rings and crosshairs
 * - Device orientation heading cone rotated with compass azimuth
 * - Center user dot
 * - Destination seat beacon dot (pulsing) positioned relative to user's heading
 * - Distance readout badge
 */
export function drawRadarOverlay(
  ctx: CanvasRenderingContext2D,
  options: RadarDrawOptions = {},
): { beaconX: number; beaconY: number; inRange: boolean } {
  const size = options.size ?? 130;
  const maxRange = options.maxRangeMeters ?? 10; // 10 meters default radius
  const heading = options.heading ?? 0;
  const bearingAngle = options.bearingAngle ?? 0;
  const distance = Math.max(0, options.distance ?? 0);
  const pulseTime = options.pulseTime ?? Date.now() / 1000;
  const seatLabel = options.seatLabel ?? "";

  const cx = size / 2;
  const cy = size / 2;
  const radius = cx - 8; // Margin inside border

  // Clear canvas
  ctx.clearRect(0, 0, size, size);

  // 1. Radar Circular Background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.85)"; // Slate-900 / 85% opacity
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)"; // Sky-400 border
  ctx.stroke();
  ctx.clip(); // Clip everything to inside circle

  // 2. Concentric Range Rings
  const ringRatios = [0.33, 0.66, 1.0];
  ringRatios.forEach((ratio) => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * ratio, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.15)";
    ctx.stroke();
  });

  // 3. Crosshairs
  ctx.beginPath();
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
  ctx.stroke();

  // 4. Heading Cone / Orientation Vision Field (facing forward / relative)
  // Rotating radar view synchronously with device compass azimuth:
  // If view is rotated with compass, forward cone points at the user's view direction.
  ctx.save();
  ctx.translate(cx, cy);

  // Subtle sweep effect
  const sweepAngle = (pulseTime * 2) % (Math.PI * 2);
  const sweepGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  sweepGradient.addColorStop(0, "rgba(56, 189, 248, 0.2)");
  sweepGradient.addColorStop(1, "rgba(56, 189, 248, 0.0)");
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, sweepAngle - 0.4, sweepAngle);
  ctx.closePath();
  ctx.fillStyle = sweepGradient;
  ctx.fill();

  // Forward heading cone (60 degree field of view)
  const coneHalfAngle = Math.PI / 6; // 30 degrees either side
  const coneGrad = ctx.createRadialGradient(0, 0, 0, 0, -radius * 0.5, radius);
  coneGrad.addColorStop(0, "rgba(14, 165, 233, 0.35)");
  coneGrad.addColorStop(1, "rgba(14, 165, 233, 0.02)");
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius * 0.85, -Math.PI / 2 - coneHalfAngle, -Math.PI / 2 + coneHalfAngle);
  ctx.closePath();
  ctx.fillStyle = coneGrad;
  ctx.fill();

  ctx.restore();

  // 5. Target Seat Beacon Dot
  // In user-centric radar view, the top is user's forward view.
  // Relative angle to seat = (bearingAngle - heading)
  const relativeAngleDeg = normalizeAngle(bearingAngle - heading);
  const relativeAngleRad = (relativeAngleDeg - 90) * (Math.PI / 180); // 0 deg is Top (-90 in canvas coord)

  // Scale distance relative to max range
  const clampedDistanceRatio = Math.min(distance / maxRange, 0.92);
  const beaconDistPx = radius * clampedDistanceRatio;

  const beaconX = cx + Math.cos(relativeAngleRad) * beaconDistPx;
  const beaconY = cy + Math.sin(relativeAngleRad) * beaconDistPx;

  // Animated pulse ring around beacon
  const pulseScale = (Math.sin(pulseTime * 4) + 1) / 2; // 0 to 1
  const pulseRadius = 5 + pulseScale * 7;
  ctx.beginPath();
  ctx.arc(beaconX, beaconY, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(16, 185, 129, ${0.8 - pulseScale * 0.6})`; // Emerald pulse
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Destination beacon dot
  ctx.beginPath();
  ctx.arc(beaconX, beaconY, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = "#10b981"; // Emerald-500
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  // Seat label next to beacon if provided
  if (seatLabel) {
    ctx.font = "bold 9px monospace";
    ctx.fillStyle = "#34d399";
    ctx.fillText(seatLabel, beaconX + 7, beaconY + 3);
  }

  // 6. User Position Dot in Center
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#38bdf8"; // Sky-400
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();

  ctx.restore(); // Restore outer clip

  return {
    beaconX,
    beaconY,
    inRange: distance <= maxRange,
  };
}
