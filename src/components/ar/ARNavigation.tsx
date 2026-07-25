"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

interface DeskSeat {
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

interface ARNavigationProps {
  session: XRSession;
  onEndSession: () => void;
  venueId: string;
  seats: DeskSeat[];
  anchors: AnchorData[];
  onSaveAnchor: (data: {
    anchorPersistId: string;
    seatId: string | null;
    bookingId: string | null;
    matrix: number[];
    label: string | null;
  }) => Promise<void>;
  onDeleteAnchor: (anchorDbId: string) => Promise<void>;
}

const SEAT_COLORS: Record<string, number> = {
  HOT_DESK: 0x3b82f6,
  FIXED_DESK: 0x22c55e,
  MEETING_ROOM: 0xf59e0b,
  PHONE_BOOTH: 0xa855f7,
};

const SEAT_LABELS: Record<string, string> = {
  HOT_DESK: "Hot Desk",
  FIXED_DESK: "Fixed Desk",
  MEETING_ROOM: "Meeting Room",
  PHONE_BOOTH: "Phone Booth",
};

const sharedGeometries = {
  surface: new THREE.BoxGeometry(0.45, 0.03, 0.3),
  leg: new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8),
  ring: new THREE.TorusGeometry(0.12, 0.015, 16, 32),
  pulse: new THREE.TorusGeometry(0.18, 0.008, 16, 32),
};

const sharedMaterials = {
  leg: new THREE.MeshPhongMaterial({ color: 0x555555 }),
};

const LEG_OFFSETS: [number, number, number][] = [
  [-0.18, 0.36, -0.12],
  [0.18, 0.36, -0.12],
  [-0.18, 0.36, 0.12],
  [0.18, 0.36, 0.12],
];

function createDeskBadge(
  seat: DeskSeat,
  isReserved: boolean,
  anchorLabel: string | null,
): THREE.Group {
  const group = new THREE.Group();
  const color = SEAT_COLORS[seat.type] ?? 0x6b7280;

  const surfaceMat = new THREE.MeshPhongMaterial({
    color: isReserved ? 0xef4444 : color,
    transparent: true,
    opacity: 0.85,
    shininess: 80,
  });
  const surface = new THREE.Mesh(sharedGeometries.surface, surfaceMat);
  surface.position.y = 0.72;
  group.add(surface);

  for (const [x, y, z] of LEG_OFFSETS) {
    const leg = new THREE.Mesh(sharedGeometries.leg, sharedMaterials.leg);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  const ringMat = new THREE.MeshPhongMaterial({
    color: isReserved ? 0xef4444 : 0x22c55e,
    emissive: isReserved ? 0xef4444 : 0x22c55e,
    emissiveIntensity: 0.4,
  });
  const ring = new THREE.Mesh(sharedGeometries.ring, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.95;
  group.add(ring);

  const label = anchorLabel ?? seat.seatNumber;
  const typeLabel = SEAT_LABELS[seat.type] ?? seat.type;
  const statusText = isReserved ? "RESERVED" : "AVAILABLE";

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.beginPath();
  ctx.roundRect(16, 16, canvas.width - 32, canvas.height - 32, 24);
  ctx.fill();

  ctx.strokeStyle = isReserved ? "#ef4444" : "#22c55e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(16, 16, canvas.width - 32, canvas.height - 32, 24);
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, canvas.width / 2, 90);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "36px sans-serif";
  ctx.fillText(typeLabel, canvas.width / 2, 140);

  ctx.fillStyle = isReserved ? "#ef4444" : "#22c55e";
  ctx.font = "bold 44px sans-serif";
  ctx.fillText(statusText, canvas.width / 2, 200);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(0.6, 0.3, 1);
  sprite.position.y = 1.25;
  group.add(sprite);

  if (isReserved) {
    const pulseMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.5,
    });
    const pulse = new THREE.Mesh(sharedGeometries.pulse, pulseMat);
    pulse.rotation.x = Math.PI / 2;
    pulse.position.y = 0.95;
    pulse.userData.isPulse = true;
    group.add(pulse);
  }

  group.userData.seatId = seat.id;
  group.userData.seatNumber = seat.seatNumber;
  group.userData.isDesk = true;
  group.userData.baseY = 0;

  return group;
}

function disposeGroupTextures(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Sprite) {
      const mat = child.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    } else if (child instanceof THREE.Mesh) {
      const mat = child.material;
      if (Array.isArray(mat)) {
        mat.forEach((m) => m.dispose());
      } else {
        mat.dispose();
      }
    }
  });
}

export default function ARNavigation({
  session,
  onEndSession,
  venueId: _venueId,
  seats,
  anchors,
  onSaveAnchor,
  onDeleteAnchor,
}: ARNavigationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const referenceSpaceRef = useRef<XRReferenceSpace | null>(null);
  const [anchorCount, setAnchorCount] = useState(anchors.length);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [referenceReady, setReferenceReady] = useState(false);

  const handleSaveAtSeat = useCallback(
    async (seatId: string, matrix: number[]) => {
      const persistId = crypto.randomUUID();
      await onSaveAnchor({
        anchorPersistId: persistId,
        seatId,
        bookingId: null,
        matrix,
        label: null,
      });
      setAnchorCount((c) => c + 1);
    },
    [onSaveAnchor],
  );

  const anchorForSeat = useCallback(
    (seatId: string) => anchors.find((a) => a.seatId === seatId),
    [anchors],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20,
    );

    const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    light.position.set(0.5, 1, 0.25);
    scene.add(light);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(1, 3, 2);
    scene.add(dirLight);

    const anchorMap = new Map<string, AnchorData>();
    for (const a of anchors) {
      if (a.seatId) anchorMap.set(a.seatId, a);
    }

    const deskGroups: THREE.Group[] = [];
    const deskMatrix = new THREE.Matrix4();

    for (const seat of seats) {
      const anchorData = anchorMap.get(seat.id);
      const isReserved = !!anchorData;
      const badge = createDeskBadge(
        seat,
        isReserved,
        anchorData?.label ?? null,
      );

      if (anchorData) {
        deskMatrix.fromArray(anchorData.matrix);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        deskMatrix.decompose(pos, quat, scale);
        badge.position.copy(pos);
        badge.quaternion.copy(quat);
        badge.userData.baseY = pos.y;
      } else {
        const idx = seats.indexOf(seat);
        const col = idx % 4;
        const row = Math.floor(idx / 4);
        badge.position.set((col - 1.5) * 0.8, 0, -2 - row * 0.8);
        badge.userData.baseY = 0;
      }

      scene.add(badge);
      deskGroups.push(badge);
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    const setupSession = async () => {
      try {
        await renderer.xr.setSession(session);
        try {
          referenceSpaceRef.current =
            await session.requestReferenceSpace("local");
        } catch {
          referenceSpaceRef.current =
            await session.requestReferenceSpace("viewer");
        }
        setReferenceReady(true);
      } catch (err) {
        console.error("Failed to set up XR session on renderer:", err);
      }
    };
    setupSession();

    const raycaster = new THREE.Raycaster();
    const tapPos = new THREE.Vector2();
    let pendingTap = false;

    const onSelectStart = () => {
      pendingTap = true;
    };
    session.addEventListener("selectstart", onSelectStart);

    const animate = () => {
      const time = Date.now() * 0.001;

      for (const desk of deskGroups) {
        const baseY = desk.userData.baseY as number;
        desk.position.y =
          baseY + Math.sin(time * 2 + desk.position.x * 3) * 0.02;

        desk.children.forEach((child) => {
          if (
            child instanceof THREE.Mesh &&
            child.userData.isPulse &&
            !Array.isArray(child.material)
          ) {
            const s = 1 + Math.sin(time * 3) * 0.15;
            child.scale.set(s, s, 1);
            child.material.opacity = 0.3 + Math.sin(time * 3) * 0.2;
          }
        });
      }

      if (pendingTap) {
        pendingTap = false;
        tapPos.set(0, 0);
        raycaster.setFromCamera(tapPos, camera);
        const hits = raycaster.intersectObjects(deskGroups, true);
        if (hits.length > 0) {
          let target: THREE.Object3D | null = hits[0].object;
          while (target && !target.userData.isDesk) {
            target = target.parent;
          }
          if (target?.userData.seatId) {
            const seatId = target.userData.seatId as string;
            setSelectedSeat((prev) => (prev === seatId ? null : seatId));
          }
        }
      }

      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);

    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onWindowResize);

    const container = containerRef.current;
    return () => {
      window.removeEventListener("resize", onWindowResize);
      session.removeEventListener("selectstart", onSelectStart);
      renderer.setAnimationLoop(null);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      for (const desk of deskGroups) {
        disposeGroupTextures(desk);
      }
    };
  }, [session, seats, anchors]);

  const canPin = referenceReady && selectedSeat && !anchorForSeat(selectedSeat);
  const canRemove =
    referenceReady && selectedSeat && !!anchorForSeat(selectedSeat);

  return (
    <div className="absolute inset-0 z-50">
      <div ref={containerRef} className="w-full h-full" />

      <div
        id="ar-overlay-root"
        className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-3 pb-6 pointer-events-none"
      >
        {(canPin || canRemove) && (
          <div className="flex gap-2 pointer-events-auto">
            {canRemove ? (
              <button
                onClick={() => {
                  const existing = anchorForSeat(selectedSeat!);
                  if (existing) {
                    onDeleteAnchor(existing.id);
                    setAnchorCount((c) => Math.max(0, c - 1));
                    setSelectedSeat(null);
                  }
                }}
                className="bg-red-500 hover:bg-red-600 text-white px-5 py-2.5 rounded-full font-semibold shadow-lg transition-colors text-sm"
              >
                Remove Anchor
              </button>
            ) : (
              <button
                onClick={() => {
                  const seat = seats.find((s) => s.id === selectedSeat);
                  if (seat && referenceSpaceRef.current) {
                    const mat = new THREE.Matrix4();
                    const pos = new THREE.Vector3(
                      seat.x * 0.01,
                      0.8,
                      seat.y * 0.01,
                    );
                    const quat = new THREE.Quaternion();
                    mat.compose(pos, quat, new THREE.Vector3(1, 1, 1));
                    const arr = new Array<number>(16);
                    mat.toArray(arr);
                    handleSaveAtSeat(selectedSeat!, arr);
                    setSelectedSeat(null);
                  }
                }}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-full font-semibold shadow-lg transition-colors text-sm"
              >
                Pin Anchor Here
              </button>
            )}
          </div>
        )}

        <div className="flex gap-3 pointer-events-auto">
          <button
            onClick={onEndSession}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-full font-semibold shadow-lg transition-colors"
          >
            End AR
          </button>
        </div>

        <div className="bg-slate-900/80 backdrop-blur-sm text-slate-300 text-xs px-4 py-2 rounded-full">
          {anchorCount} anchor{anchorCount !== 1 ? "s" : ""} active
        </div>
      </div>
    </div>
  );
}
