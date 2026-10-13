import * as THREE from "three";
import type {
  PeerAvatar,
  StagePosition,
  LocalUserAvatar,
} from "./SpatialAudioStage";

export interface GeodesicRadarDomeSceneOptions {
  radius?: number;
  stageWidth?: number;
  stageHeight?: number;
  emeraldColor?: number;
  neonHighlightColor?: number;
  backgroundAlpha?: number;
}

export interface AcousticRipple {
  id: string;
  peerId: string;
  origin: THREE.Vector3;
  radius: number;
  maxRadius: number;
  speed: number;
  intensity: number;
  mesh: THREE.LineLoop;
  points: THREE.Vector3[];
}

export interface GeodesicRadarDomeSceneController {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer | null;
  domeGroup: THREE.Group;
  wireframeMesh: THREE.LineSegments;
  latitudeRings: THREE.LineLoop[];
  equatorRing: THREE.LineLoop;
  groundGrid: THREE.Group;
  peerGroup: THREE.Group;
  localUserMarker: THREE.Group;
  rippleGroup: THREE.Group;
  options: Required<GeodesicRadarDomeSceneOptions>;
  updatePeers: (
    peers: PeerAvatar[],
    localUser: LocalUserAvatar,
    peerAudioLevels?: Record<string, number>,
  ) => void;
  triggerAcousticRipple: (
    peerId: string,
    intensity?: number,
  ) => AcousticRipple | null;
  animateFrame: (deltaTime?: number, totalAudioLevel?: number) => void;
  dispose: () => void;
}

/**
 * Projects a 2D stage pixel coordinate to 3D stage ground plane coordinates (y = 0).
 */
export function projectStageTo3DGround(
  stagePos: StagePosition,
  stageWidth: number,
  stageHeight: number,
  groundRadius: number = 4.0,
): { x: number; y: number; z: number } {
  const normX =
    ((stagePos.x - stageWidth / 2) / (stageWidth / 2)) * groundRadius;
  const normZ =
    ((stagePos.y - stageHeight / 2) / (stageHeight / 2)) * groundRadius;
  return {
    x: normX,
    y: 0,
    z: normZ,
  };
}

/**
 * Calculates the dome surface height at a given (x, z) coordinate on the ground plane.
 */
export function computeDomeSurfaceHeight(
  x: number,
  z: number,
  radius: number,
): number {
  const distSq = x * x + z * z;
  const radSq = radius * radius;
  if (distSq >= radSq) return 0;
  return Math.sqrt(radSq - distSq);
}

/**
 * Detects whether WebGL 1.0 or 2.0 context is supported by the environment.
 */
export function isWebGLAvailable(canvas?: HTMLCanvasElement | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = canvas || document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl2") ||
        c.getContext("webgl") ||
        c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

/**
 * Constructs the Three.js 3D wireframe geodesic radar dome scene with
 * neon emerald lines, coworker 3D ground projections, and acoustic wave ripples.
 */
export function createGeodesicRadarDomeScene(
  canvas: HTMLCanvasElement | null,
  options: GeodesicRadarDomeSceneOptions = {},
): GeodesicRadarDomeSceneController {
  const opts: Required<GeodesicRadarDomeSceneOptions> = {
    radius: options.radius ?? 5.0,
    stageWidth: options.stageWidth ?? 600,
    stageHeight: options.stageHeight ?? 400,
    emeraldColor: options.emeraldColor ?? 0x10b981,
    neonHighlightColor: options.neonHighlightColor ?? 0x34d399,
    backgroundAlpha: options.backgroundAlpha ?? 0,
  };

  const scene = new THREE.Scene();

  // 3D Perspective Camera looking into the acoustic stage at an angle
  const aspect = opts.stageWidth / opts.stageHeight;
  const camera = new THREE.PerspectiveCamera(48, aspect, 0.1, 100);
  camera.position.set(0, 6.2, 10.5);
  camera.lookAt(0, 0.8, 0);

  // Holographic Dome Group (rotates slowly for holographic radar effect)
  const domeGroup = new THREE.Group();
  domeGroup.name = "holographic-geodesic-dome";
  scene.add(domeGroup);

  // 1. 3D Wireframe Hemisphere Geometry with neon emerald lines
  // SphereGeometry with thetaLength = Math.PI / 2 creates a hemisphere (y >= 0)
  const hemisphereGeo = new THREE.SphereGeometry(
    opts.radius,
    24, // longitude ribs
    12, // latitude rings
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  const wireframeGeo = new THREE.WireframeGeometry(hemisphereGeo);
  const domeMaterial = new THREE.LineBasicMaterial({
    color: opts.emeraldColor,
    transparent: true,
    opacity: 0.65,
  });
  const wireframeMesh = new THREE.LineSegments(wireframeGeo, domeMaterial);
  wireframeMesh.name = "wireframe-hemisphere";
  domeGroup.add(wireframeMesh);

  // 2. Latitude Grid Rings (horizontal rings at various heights along dome)
  const latitudeRings: THREE.LineLoop[] = [];
  const latDegrees = [15, 30, 45, 60, 75];
  latDegrees.forEach((deg) => {
    const rad = (deg * Math.PI) / 180;
    const r = opts.radius * Math.cos(rad);
    const y = opts.radius * Math.sin(rad);
    const ringPoints: THREE.Vector3[] = [];
    const segments = 48;
    for (let i = 0; i < segments; i++) {
      const phi = (i / segments) * Math.PI * 2;
      ringPoints.push(
        new THREE.Vector3(r * Math.cos(phi), y, r * Math.sin(phi)),
      );
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMat = new THREE.LineBasicMaterial({
      color: opts.neonHighlightColor,
      transparent: true,
      opacity: 0.55,
    });
    const ring = new THREE.LineLoop(ringGeo, ringMat);
    ring.name = `latitude-ring-${deg}deg`;
    latitudeRings.push(ring);
    domeGroup.add(ring);
  });

  // 3. Equator Ring on ground plane (y = 0.01)
  const equatorPoints: THREE.Vector3[] = [];
  const eqSegments = 64;
  for (let i = 0; i < eqSegments; i++) {
    const phi = (i / eqSegments) * Math.PI * 2;
    equatorPoints.push(
      new THREE.Vector3(
        opts.radius * Math.cos(phi),
        0.01,
        opts.radius * Math.sin(phi),
      ),
    );
  }
  const equatorGeo = new THREE.BufferGeometry().setFromPoints(equatorPoints);
  const equatorMat = new THREE.LineBasicMaterial({
    color: 0x059669,
    transparent: true,
    opacity: 0.75,
  });
  const equatorRing = new THREE.LineLoop(equatorGeo, equatorMat);
  equatorRing.name = "equator-base-ring";
  domeGroup.add(equatorRing);

  // 4. Ground Grid & Range Rings
  const groundGrid = new THREE.Group();
  groundGrid.name = "ground-acoustic-grid";
  [1.0, 2.0, 3.0, 4.0].forEach((rangeR) => {
    if (rangeR < opts.radius) {
      const rangePts: THREE.Vector3[] = [];
      const numPts = 36;
      for (let i = 0; i < numPts; i++) {
        const phi = (i / numPts) * Math.PI * 2;
        rangePts.push(
          new THREE.Vector3(
            rangeR * Math.cos(phi),
            0.005,
            rangeR * Math.sin(phi),
          ),
        );
      }
      const rGeo = new THREE.BufferGeometry().setFromPoints(rangePts);
      const rMat = new THREE.LineBasicMaterial({
        color: 0x047857,
        transparent: true,
        opacity: 0.35,
      });
      const rLoop = new THREE.LineLoop(rGeo, rMat);
      groundGrid.add(rLoop);
    }
  });

  // Ground Crosshairs (Axes X and Z)
  const axisXGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-opts.radius * 0.95, 0.005, 0),
    new THREE.Vector3(opts.radius * 0.95, 0.005, 0),
  ]);
  const axisZGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.005, -opts.radius * 0.95),
    new THREE.Vector3(0, 0.005, opts.radius * 0.95),
  ]);
  const axisMat = new THREE.LineBasicMaterial({
    color: 0x064e3b,
    transparent: true,
    opacity: 0.4,
  });
  groundGrid.add(new THREE.Line(axisXGeo, axisMat));
  groundGrid.add(new THREE.Line(axisZGeo, axisMat));
  scene.add(groundGrid);

  // Rotating Radar Sweep Spoke Line
  const sweepGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(opts.radius, 0.02, 0),
  ]);
  const sweepMat = new THREE.LineBasicMaterial({
    color: 0x6ee7b7,
    transparent: true,
    opacity: 0.4,
  });
  const sweepLine = new THREE.Line(sweepGeo, sweepMat);
  sweepLine.name = "radar-sweep-spoke";
  domeGroup.add(sweepLine);

  // 5. Peer Avatar 3D Ground Projections Group
  const peerGroup = new THREE.Group();
  peerGroup.name = "peer-ground-projections";
  scene.add(peerGroup);

  // Local User Listener Marker
  const localUserMarker = new THREE.Group();
  localUserMarker.name = "local-listener-marker";
  const listenerDiscGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16);
  const listenerDiscMat = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.85,
  });
  const listenerDisc = new THREE.Mesh(listenerDiscGeo, listenerDiscMat);
  listenerDisc.position.y = 0.015;
  localUserMarker.add(listenerDisc);

  const listenerHaloPts: THREE.Vector3[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    listenerHaloPts.push(
      new THREE.Vector3(0.42 * Math.cos(a), 0.02, 0.42 * Math.sin(a)),
    );
  }
  const listenerHaloGeo = new THREE.BufferGeometry().setFromPoints(
    listenerHaloPts,
  );
  const listenerHaloMat = new THREE.LineBasicMaterial({
    color: 0x60a5fa,
    transparent: true,
    opacity: 0.75,
  });
  localUserMarker.add(new THREE.LineLoop(listenerHaloGeo, listenerHaloMat));
  scene.add(localUserMarker);

  // 6. Surface Wave Ripples Group
  const rippleGroup = new THREE.Group();
  rippleGroup.name = "dome-surface-wave-ripples";
  scene.add(rippleGroup);

  // Map of active acoustic wave ripples
  const activeRipples: AcousticRipple[] = [];

  // Track peer marker groups by peer ID
  const peerMarkerMap = new Map<string, THREE.Group>();
  const peerCoords3DMap = new Map<string, THREE.Vector3>();

  // Initialize WebGLRenderer if supported
  let renderer: THREE.WebGLRenderer | null = null;
  if (canvas && isWebGLAvailable(canvas)) {
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
      });
      renderer.setSize(opts.stageWidth, opts.stageHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } catch {
      renderer = null;
    }
  }

  // Update peer positions projected onto 3D ground plane
  const updatePeers = (
    peers: PeerAvatar[],
    localUser: LocalUserAvatar,
    peerAudioLevels?: Record<string, number>,
  ) => {
    // Project local user
    const localCoords = projectStageTo3DGround(
      localUser.position,
      opts.stageWidth,
      opts.stageHeight,
      opts.radius * 0.82,
    );
    localUserMarker.position.set(localCoords.x, 0, localCoords.z);

    const activePeerIds = new Set(peers.map((p) => p.id));

    // Remove deleted peers
    for (const [id, marker] of peerMarkerMap.entries()) {
      if (!activePeerIds.has(id)) {
        peerGroup.remove(marker);
        peerMarkerMap.delete(id);
        peerCoords3DMap.delete(id);
      }
    }

    // Add or update peer markers
    peers.forEach((peer) => {
      const pCoords = projectStageTo3DGround(
        peer.position,
        opts.stageWidth,
        opts.stageHeight,
        opts.radius * 0.82,
      );
      peerCoords3DMap.set(peer.id, new THREE.Vector3(pCoords.x, 0, pCoords.z));

      let marker = peerMarkerMap.get(peer.id);
      const domeSurfaceY = computeDomeSurfaceHeight(
        pCoords.x,
        pCoords.z,
        opts.radius,
      );

      if (!marker) {
        marker = new THREE.Group();
        marker.name = `peer-marker-${peer.id}`;

        // Base ground disc
        const pColor = peer.color
          ? parseInt(peer.color.replace("#", "0x"), 16) || opts.emeraldColor
          : opts.emeraldColor;
        const pDiscGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.03, 16);
        const pDiscMat = new THREE.MeshBasicMaterial({
          color: pColor,
          transparent: true,
          opacity: 0.85,
        });
        const pDisc = new THREE.Mesh(pDiscGeo, pDiscMat);
        pDisc.position.y = 0.015;
        pDisc.name = "base-disc";
        marker.add(pDisc);

        // Ground pulse halo ring
        const pHaloPts: THREE.Vector3[] = [];
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          pHaloPts.push(
            new THREE.Vector3(0.38 * Math.cos(a), 0.02, 0.38 * Math.sin(a)),
          );
        }
        const pHaloGeo = new THREE.BufferGeometry().setFromPoints(pHaloPts);
        const pHaloMat = new THREE.LineBasicMaterial({
          color: opts.neonHighlightColor,
          transparent: true,
          opacity: 0.7,
        });
        const pHalo = new THREE.LineLoop(pHaloGeo, pHaloMat);
        pHalo.name = "halo-ring";
        marker.add(pHalo);

        // Vertical acoustic projection ray connecting ground plane to dome surface
        const rayGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0.02, 0),
          new THREE.Vector3(0, Math.max(0.2, domeSurfaceY), 0),
        ]);
        const rayMat = new THREE.LineBasicMaterial({
          color: opts.emeraldColor,
          transparent: true,
          opacity: 0.4,
        });
        const ray = new THREE.Line(rayGeo, rayMat);
        ray.name = "vertical-projection-ray";
        marker.add(ray);

        // Dome surface contact beacon sphere
        const pSphereGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const pSphereMat = new THREE.MeshBasicMaterial({
          color: 0x6ee7b7,
          transparent: true,
          opacity: 0.9,
        });
        const pSphere = new THREE.Mesh(pSphereGeo, pSphereMat);
        pSphere.position.y = Math.max(0.2, domeSurfaceY);
        pSphere.name = "dome-contact-beacon";
        marker.add(pSphere);

        peerGroup.add(marker);
        peerMarkerMap.set(peer.id, marker);
      } else {
        // Update existing marker's vertical ray to new dome height
        const ray = marker.getObjectByName(
          "vertical-projection-ray",
        ) as THREE.Line;
        if (ray) {
          ray.geometry.setFromPoints([
            new THREE.Vector3(0, 0.02, 0),
            new THREE.Vector3(0, Math.max(0.2, domeSurfaceY), 0),
          ]);
        }
        const sphere = marker.getObjectByName(
          "dome-contact-beacon",
        ) as THREE.Mesh;
        if (sphere) {
          sphere.position.y = Math.max(0.2, domeSurfaceY);
        }
      }

      // Update position on ground plane
      marker.position.set(pCoords.x, 0, pCoords.z);

      // Check audio level to spawn radiant acoustic ripples
      const audioLevel = peerAudioLevels?.[peer.id] ?? 0;
      if (audioLevel > 0.05) {
        // Trigger acoustic wave ripple
        triggerAcousticRipple(peer.id, audioLevel);
      }
    });
  };

  // Trigger a radiant acoustic ripple emanating from a peer across the dome surface
  const triggerAcousticRipple = (
    peerId: string,
    intensity: number = 0.5,
  ): AcousticRipple | null => {
    const origin = peerCoords3DMap.get(peerId);
    if (!origin) return null;

    // Limit concurrent ripples to prevent performance degradation
    if (activeRipples.length > 20) {
      const oldest = activeRipples.shift();
      if (oldest) {
        rippleGroup.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
      }
    }

    const segments = 36;
    const initialPoints: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      initialPoints.push(new THREE.Vector3(origin.x, 0.03, origin.z));
    }

    const rippleGeo = new THREE.BufferGeometry().setFromPoints(initialPoints);
    const rippleMat = new THREE.LineBasicMaterial({
      color: intensity > 0.4 ? 0x00ff9d : opts.emeraldColor,
      transparent: true,
      opacity: Math.min(1.0, 0.7 + intensity * 0.3),
    });
    const rippleMesh = new THREE.LineLoop(rippleGeo, rippleMat);
    rippleMesh.name = `ripple-${peerId}-${Date.now()}`;
    rippleGroup.add(rippleMesh);

    const ripple: AcousticRipple = {
      id: `${peerId}-${Date.now()}-${Math.random()}`,
      peerId,
      origin: origin.clone(),
      radius: 0.1,
      maxRadius: opts.radius * 1.3,
      speed: 0.04 + intensity * 0.05,
      intensity,
      mesh: rippleMesh,
      points: initialPoints,
    };

    activeRipples.push(ripple);
    return ripple;
  };

  // Animate one frame: rotate holographic dome, expand wave ripples, and pulse emerald luminance
  const animateFrame = (
    _deltaTime: number = 0.016,
    totalAudioLevel: number = 0,
  ) => {
    // 1. Rotating holographic hemisphere
    domeGroup.rotation.y += 0.003;

    // 2. Pulse wireframe emerald lines with active voice audio streams
    const pulseFactor = Math.min(0.4, totalAudioLevel * 0.6);
    domeMaterial.opacity = 0.55 + pulseFactor;
    if (totalAudioLevel > 0.25) {
      domeMaterial.color.setHex(0x00ff9d);
    } else {
      domeMaterial.color.setHex(opts.emeraldColor);
    }

    // 3. Expand and project acoustic ripples along dome surface
    for (let i = activeRipples.length - 1; i >= 0; i--) {
      const rip = activeRipples[i];
      rip.radius += rip.speed;
      const progress = rip.radius / rip.maxRadius;

      if (progress >= 1.0) {
        // Expired ripple
        rippleGroup.remove(rip.mesh);
        rip.mesh.geometry.dispose();
        activeRipples.splice(i, 1);
        continue;
      }

      // Update ripple points along dome surface
      const segments = 36;
      const updatedPts: THREE.Vector3[] = [];
      for (let s = 0; s < segments; s++) {
        const angle = (s / segments) * Math.PI * 2;
        const px = rip.origin.x + rip.radius * Math.cos(angle);
        const pz = rip.origin.z + rip.radius * Math.sin(angle);

        // Project height along dome hemisphere surface curvature
        const surfaceY = computeDomeSurfaceHeight(px, pz, opts.radius);
        // Ripple elevates along dome surface as it expands
        const heightY = Math.max(
          0.03,
          surfaceY * Math.min(1.0, progress * 1.5),
        );
        updatedPts.push(new THREE.Vector3(px, heightY, pz));
      }

      rip.mesh.geometry.setFromPoints(updatedPts);
      const mat = rip.mesh.material as THREE.LineBasicMaterial;
      if (mat) {
        mat.opacity = (1 - progress) * 0.85 * rip.intensity;
      }
    }

    // 4. Render 3D scene if renderer exists
    if (renderer) {
      renderer.render(scene, camera);
    }
  };

  // Dispose all Three.js resources cleanly
  const dispose = () => {
    activeRipples.forEach((rip) => {
      rippleGroup.remove(rip.mesh);
      rip.mesh.geometry.dispose();
    });
    activeRipples.length = 0;

    hemisphereGeo.dispose();
    wireframeGeo.dispose();
    domeMaterial.dispose();
    equatorGeo.dispose();
    equatorMat.dispose();

    latitudeRings.forEach((ring) => {
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    });

    if (renderer) {
      renderer.dispose();
    }
  };

  return {
    scene,
    camera,
    renderer,
    domeGroup,
    wireframeMesh,
    latitudeRings,
    equatorRing,
    groundGrid,
    peerGroup,
    localUserMarker,
    rippleGroup,
    options: opts,
    updatePeers,
    triggerAcousticRipple,
    animateFrame,
    dispose,
  };
}
