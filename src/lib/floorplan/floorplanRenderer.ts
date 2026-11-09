import * as THREE from "three";
import {
  get3DPosition,
  SCENE_SCALE,
  SVG_HEIGHT,
  SVG_WIDTH,
} from "@/lib/floorPlan";
import {
  createFloorplanRenderTargets,
  createFloorplanShaderMaterials,
  type FloorplanRenderTargets,
} from "@/lib/floorplan/floorplanShaders";
import type { SeatProps } from "@/components/floorplan/FloorPlanViewer3D";
import type { NavigationRoute } from "@/lib/floorplan/accessibleNavigation";

type ShaderMaterials = ReturnType<typeof createFloorplanShaderMaterials>;

export interface FloorplanRendererCallbacks {
  onSelectSeat: (id: string | null) => void;
  onHoverSeat: (id: string | null) => void;
}

function seatColor(seat: SeatProps, selected: boolean, hovered: boolean): string {
  if (selected) return "#6366f1";
  if (!seat.available) return "#ef4444";
  if (hovered) return "#10b981";
  if (seat.type === "MEETING_ROOM") return "#8b5cf6";
  if (seat.type === "PHONE_BOOTH") return "#ec4899";
  return "#3b82f6";
}

function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose());
  } else {
    mesh.material?.dispose();
  }
}

export class FloorplanRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
  private readonly seatGroup = new THREE.Group();
  private readonly navigationGroup = new THREE.Group();
  private readonly architecturalGroup = new THREE.Group();
  private readonly normalMaterial = new THREE.MeshNormalMaterial({
    side: THREE.DoubleSide,
  });
  private readonly fullscreenScene = new THREE.Scene();
  private readonly fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fullscreenQuad: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  >;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly materials: ShaderMaterials;
  private targets: FloorplanRenderTargets;
  private seatMesh: THREE.InstancedMesh | null = null;
  private readonly seatsByInstance: SeatProps[] = [];
  private readonly seatPositions = new Map<string, THREE.Vector3>();
  private callbacks: FloorplanRendererCallbacks;
  private selectedSeat: string | null = null;
  private hoveredSeat: string | null = null;
  private accessibleNavigationEnabled = false;
  private currentRoute: NavigationRoute | null = null;
  private routeLineMesh: THREE.Mesh | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrame = 0;
  private destroyed = false;
  private readonly resizeHandler = () => this.resize();
  private readonly pointerMoveHandler = (event: PointerEvent) =>
    this.handlePointerMove(event);
  private readonly pointerLeaveHandler = () => this.setHoveredSeat(null);
  private readonly clickHandler = (event: MouseEvent) => this.handleClick(event);
  private readonly frameHandler = () => this.renderFrame();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    callbacks: FloorplanRendererCallbacks,
  ) {
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: false,
      antialias: false,
      powerPreference: "low-power",
      precision: "mediump",
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor("#111821", 1);

    this.targets = createFloorplanRenderTargets(1, 1);
    this.materials = createFloorplanShaderMaterials();
    this.fullscreenQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.materials.ssao,
    );
    this.fullscreenScene.add(this.fullscreenQuad);

    this.setupScene();
    this.setupCamera();
    this.canvas.addEventListener("pointermove", this.pointerMoveHandler);
    this.canvas.addEventListener("pointerleave", this.pointerLeaveHandler);
    this.canvas.addEventListener("click", this.clickHandler);
    window.addEventListener("resize", this.resizeHandler);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.resizeHandler);
      this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    }

    this.resize();
    this.animationFrame = requestAnimationFrame(this.frameHandler);
  }

  setCallbacks(callbacks: FloorplanRendererCallbacks) {
    this.callbacks = callbacks;
  }

  setAccessibleNavigation(enabled: boolean) {
    this.accessibleNavigationEnabled = enabled;
    this.updateArchitecturalHighlights();
    if (this.currentRoute) {
      this.setNavigationRoute(this.currentRoute);
    }
  }

  setNavigationRoute(route: NavigationRoute | null) {
    this.currentRoute = route;

    if (this.routeLineMesh) {
      this.navigationGroup.remove(this.routeLineMesh);
      disposeObject(this.routeLineMesh);
      this.routeLineMesh = null;
    }

    if (!route || route.points3D.length < 2) {
      return;
    }

    const vectors = route.points3D.map(([x, y, z]) => new THREE.Vector3(x, y + 0.08, z));
    const curve = new THREE.CatmullRomCurve3(vectors);
    const tubeGeometry = new THREE.TubeGeometry(curve, vectors.length * 8, 0.12, 8, false);

    const isEmerald = this.accessibleNavigationEnabled && route.isAccessible;
    const material = new THREE.MeshStandardMaterial({
      color: isEmerald ? "#10b981" : "#818cf8",
      emissive: isEmerald ? "#059669" : "#4f46e5",
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.1,
    });

    const tubeMesh = new THREE.Mesh(tubeGeometry, material);
    tubeMesh.userData = { accessibleRoute: route.isAccessible };
    this.routeLineMesh = tubeMesh;
    this.navigationGroup.add(tubeMesh);
  }

  setSeats(seats: SeatProps[]) {
    this.seatMesh?.dispose();
    this.seatGroup.children.forEach(disposeObject);
    this.seatGroup.clear();
    this.seatMesh = null;
    this.seatsByInstance.length = 0;
    this.seatPositions.clear();
    if (seats.length === 0) return;

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: "#ffffff",
        roughness: 0.62,
        metalness: 0.08,
      }),
      seats.length,
    );
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const transform = new THREE.Object3D();

    seats.forEach((seat, instanceId) => {
      const height = seat.type === "MEETING_ROOM" ? 1.15 : seat.type === "PHONE_BOOTH" ? 1.55 : 0.48;
      const position = get3DPosition(
        seat.x,
        seat.y,
        seat.width,
        seat.height,
        height / 2,
      );
      transform.position.set(...position);
      transform.scale.set(
        Math.max(0.12, seat.width * SCENE_SCALE),
        height,
        Math.max(0.12, seat.height * SCENE_SCALE),
      );
      transform.updateMatrix();
      mesh.setMatrixAt(instanceId, transform.matrix);
      mesh.setColorAt(
        instanceId,
        new THREE.Color(
          seatColor(seat, this.selectedSeat === seat.id, this.hoveredSeat === seat.id),
        ),
      );
      this.seatsByInstance.push(seat);
      this.seatPositions.set(seat.id, new THREE.Vector3(...position));
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.seatMesh = mesh;
    this.seatGroup.add(mesh);
    this.updateSeatAppearance();
  }

  setSelectedSeat(seatId: string | null) {
    this.selectedSeat = seatId;
    this.updateSeatAppearance();
  }

  pan(x: number, z: number) {
    const target = this.camera.userData.target as THREE.Vector3;
    const floorWidth = SVG_WIDTH * SCENE_SCALE;
    const floorDepth = SVG_HEIGHT * SCENE_SCALE;
    const margin = 2.0;
    const maxPanX = floorWidth / 2 + margin;
    const maxPanZ = floorDepth / 2 + margin;

    const newTargetX = THREE.MathUtils.clamp(target.x + x, -maxPanX, maxPanX);
    const newTargetZ = THREE.MathUtils.clamp(target.z + z, -maxPanZ, maxPanZ);

    const deltaX = newTargetX - target.x;
    const deltaZ = newTargetZ - target.z;

    target.x = newTargetX;
    target.z = newTargetZ;
    this.camera.position.x += deltaX;
    this.camera.position.z += deltaZ;
    this.camera.lookAt(target);
  }

  zoom(factor: number) {
    const target = this.camera.userData.target as THREE.Vector3;
    const offset = this.camera.position.clone().sub(target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, 12, 58);
    offset.setLength(distance);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }

  resetView() {
    const target = this.camera.userData.target as THREE.Vector3;
    target.set(0, 0, 0);
    this.camera.position.set(0, 25, 34);
    this.camera.lookAt(target);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    window.removeEventListener("resize", this.resizeHandler);
    this.canvas.removeEventListener("pointermove", this.pointerMoveHandler);
    this.canvas.removeEventListener("pointerleave", this.pointerLeaveHandler);
    this.canvas.removeEventListener("click", this.clickHandler);

    this.scene.traverse(disposeObject);
    this.fullscreenScene.traverse(disposeObject);
    this.normalMaterial.dispose();
    Object.values(this.materials).forEach((material) => material.dispose());
    this.targets.dispose();
    this.renderer.dispose();
  }

  private setupScene() {
    this.scene.background = new THREE.Color("#111821");
    this.scene.add(new THREE.HemisphereLight("#edf6ff", "#283341", 2.1));
    const keyLight = new THREE.DirectionalLight("#fff1d6", 2.8);
    keyLight.position.set(-8, 18, 9);
    this.scene.add(keyLight);
    this.scene.add(this.seatGroup);
    this.scene.add(this.architecturalGroup);
    this.scene.add(this.navigationGroup);

    const floorWidth = SVG_WIDTH * SCENE_SCALE;
    const floorDepth = SVG_HEIGHT * SCENE_SCALE;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorWidth, floorDepth),
      new THREE.MeshStandardMaterial({
        color: "#202b32",
        roughness: 0.92,
        metalness: 0.02,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.035;
    floor.receiveShadow = false;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(
      Math.max(floorWidth, floorDepth),
      31,
      "#607078",
      "#35434a",
    );
    grid.position.y = -0.015;
    const gridMaterials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.26;
    });
    this.scene.add(grid);

    const shellMaterial = new THREE.MeshStandardMaterial({
      color: "#9aabb3",
      roughness: 0.82,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shellHeight = 2.6;
    const wallThickness = 0.12;
    const halfWidth = floorWidth / 2;
    const halfDepth = floorDepth / 2;
    const walls = [
      { width: floorWidth, depth: wallThickness, x: 0, z: -halfDepth },
      { width: floorWidth, depth: wallThickness, x: 0, z: halfDepth },
      { width: wallThickness, depth: floorDepth, x: -halfWidth, z: 0 },
      { width: wallThickness, depth: floorDepth, x: halfWidth, z: 0 },
    ];
    for (const wall of walls) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(wall.width, shellHeight, wall.depth),
        shellMaterial.clone(),
      );
      mesh.position.set(wall.x, shellHeight / 2, wall.z);
      this.scene.add(mesh);
    }

    this.setupArchitecturalMeshes();
  }

  /**
   * Sets up 3D architectural nodes: Flat Ramps, Elevator Corridors, Stairs, and Gates
   * tagged with metadata property accessibleRoute: boolean.
   */
  private setupArchitecturalMeshes() {
    this.architecturalGroup.children.forEach(disposeObject);
    this.architecturalGroup.clear();

    // 1. Flat Access Ramp (South-West) - accessibleRoute: true
    const rampGeom = new THREE.BoxGeometry(1.8, 0.08, 3.2);
    const rampMat = new THREE.MeshStandardMaterial({
      color: "#10b981",
      roughness: 0.4,
      metalness: 0.1,
    });
    const rampMesh = new THREE.Mesh(rampGeom, rampMat);
    rampMesh.position.set(-3, 0.04, 7.5);
    rampMesh.userData = {
      accessibleRoute: true,
      name: "Wide Access Gate & Flat Ramp",
      type: "ramp",
    };
    this.architecturalGroup.add(rampMesh);

    // 2. Elevator Concourse (West) - accessibleRoute: true
    const elevGeom = new THREE.BoxGeometry(2.4, 0.06, 3.5);
    const elevMat = new THREE.MeshStandardMaterial({
      color: "#059669",
      roughness: 0.3,
      metalness: 0.2,
    });
    const elevMesh = new THREE.Mesh(elevGeom, elevMat);
    elevMesh.position.set(-4.5, 0.03, 1);
    elevMesh.userData = {
      accessibleRoute: true,
      name: "Elevator Lobby & Wide Corridor",
      type: "elevator",
    };
    this.architecturalGroup.add(elevMesh);

    // 3. North Flat Ramp - accessibleRoute: true
    const northRampGeom = new THREE.BoxGeometry(1.6, 0.08, 2.8);
    const northRampMat = new THREE.MeshStandardMaterial({
      color: "#10b981",
      roughness: 0.4,
    });
    const northRampMesh = new THREE.Mesh(northRampGeom, northRampMat);
    northRampMesh.position.set(-4, 0.04, -3);
    northRampMesh.userData = {
      accessibleRoute: true,
      name: "North Deck Flat Ramp",
      type: "ramp",
    };
    this.architecturalGroup.add(northRampMesh);

    // 4. East Mezzanine Stairs - accessibleRoute: false
    const stairsGeom = new THREE.BoxGeometry(1.4, 0.4, 3.0);
    const stairsMat = new THREE.MeshStandardMaterial({
      color: "#64748b",
      roughness: 0.8,
    });
    const stairsMesh = new THREE.Mesh(stairsGeom, stairsMat);
    stairsMesh.position.set(5, 0.2, 1);
    stairsMesh.userData = {
      accessibleRoute: false,
      name: "East Mezzanine Stairs",
      type: "stairs",
    };
    this.architecturalGroup.add(stairsMesh);

    // 5. Turnstiles - accessibleRoute: false
    const turnstileGeom = new THREE.BoxGeometry(1.2, 0.6, 0.8);
    const turnstileMat = new THREE.MeshStandardMaterial({
      color: "#94a3b8",
      roughness: 0.5,
    });
    const turnstileMesh = new THREE.Mesh(turnstileGeom, turnstileMat);
    turnstileMesh.position.set(3, 0.3, 7.5);
    turnstileMesh.userData = {
      accessibleRoute: false,
      name: "Turnstile Security Gate",
      type: "turnstile",
    };
    this.architecturalGroup.add(turnstileMesh);

    this.updateArchitecturalHighlights();
  }

  private updateArchitecturalHighlights() {
    this.architecturalGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.userData) return;

      const isAccessible = mesh.userData.accessibleRoute === true;
      const mat = mesh.material as THREE.MeshStandardMaterial;

      if (isAccessible) {
        if (this.accessibleNavigationEnabled) {
          mat.color.set("#10b981");
          mat.emissive.set("#059669");
          mat.emissiveIntensity = 0.4;
        } else {
          mat.color.set("#2dd4bf");
          mat.emissive.set("#000000");
          mat.emissiveIntensity = 0;
        }
      } else {
        if (this.accessibleNavigationEnabled) {
          mat.color.set("#475569");
          mat.opacity = 0.4;
          mat.transparent = true;
        } else {
          mat.color.set("#94a3b8");
          mat.opacity = 1.0;
          mat.transparent = false;
        }
      }
    });
  }

  private setupCamera() {
    this.camera.position.set(0, 25, 34);
    this.camera.userData.target = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(this.camera.userData.target);
  }

  private resize() {
    if (this.destroyed) return;
    const bounds = (this.canvas.parentElement ?? this.canvas).getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width));
    const height = Math.max(1, Math.floor(bounds.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.targets.setSize(width, height);

    const bufferWidth = this.targets.color.width;
    const bufferHeight = this.targets.color.height;
    const texelSize = new THREE.Vector2(1 / bufferWidth, 1 / bufferHeight);
    this.materials.bilateralBlur.uniforms.uTexelSize.value.copy(texelSize);
    this.materials.composite.uniforms.uTexelSize.value.copy(texelSize);
    this.materials.ssao.uniforms.uRadius.value = 4 / bufferWidth;
  }

  private updateSeatAppearance() {
    if (!this.seatMesh) return;
    this.seatsByInstance.forEach((seat, instanceId) => {
      this.seatMesh?.setColorAt(
        instanceId,
        new THREE.Color(
          seatColor(
            seat,
            seat.id === this.selectedSeat,
            seat.id === this.hoveredSeat,
          ),
        ),
      );
    });
    if (this.seatMesh.instanceColor) this.seatMesh.instanceColor.needsUpdate = true;
  }

  private handlePointerMove(event: PointerEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.seatMesh
      ? this.raycaster.intersectObject(this.seatMesh, false)
      : [];
    const seatId =
      intersections[0]?.instanceId === undefined
        ? null
        : this.seatsByInstance[intersections[0].instanceId]?.id ?? null;
    this.setHoveredSeat(seatId);
  }

  private handleClick(event: MouseEvent) {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.seatMesh
      ? this.raycaster.intersectObject(this.seatMesh, false)
      : [];
    const instanceId = intersections[0]?.instanceId;
    const seat = instanceId === undefined ? undefined : this.seatsByInstance[instanceId];
    this.callbacks.onSelectSeat(seat?.available ? seat.id : null);
  }

  private setHoveredSeat(seatId: string | null) {
    if (this.hoveredSeat === seatId) return;
    this.hoveredSeat = seatId;
    this.updateSeatAppearance();
    this.callbacks.onHoverSeat(seatId);
  }

  private renderFullscreen(
    material: THREE.ShaderMaterial,
    target: THREE.WebGLRenderTarget | null,
  ) {
    this.fullscreenQuad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.fullscreenScene, this.fullscreenCamera);
  }

  private renderFrame() {
    if (this.destroyed) return;
    this.animationFrame = requestAnimationFrame(this.frameHandler);
    if (document.hidden) return;

    const depthTexture = this.targets.color.depthTexture;
    if (!depthTexture) return;

    this.camera.updateMatrixWorld();
    this.renderer.setRenderTarget(this.targets.color);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    const previousOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this.normalMaterial;
    this.renderer.setRenderTarget(this.targets.normal);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = previousOverride;

    this.materials.ssao.uniforms.tDepth.value = depthTexture;
    this.materials.ssao.uniforms.tNormal.value = this.targets.normal.texture;
    this.materials.ssao.uniforms.uNear.value = this.camera.near;
    this.materials.ssao.uniforms.uFar.value = this.camera.far;
    this.renderFullscreen(this.materials.ssao, this.targets.ao);

    const blurUniforms = this.materials.bilateralBlur.uniforms;
    blurUniforms.tDepth.value = depthTexture;
    blurUniforms.tNormal.value = this.targets.normal.texture;
    blurUniforms.tInput.value = this.targets.ao.texture;
    blurUniforms.uDirection.value.set(1, 0);
    this.renderFullscreen(this.materials.bilateralBlur, this.targets.blurA);
    blurUniforms.tInput.value = this.targets.blurA.texture;
    blurUniforms.uDirection.value.set(0, 1);
    this.renderFullscreen(this.materials.bilateralBlur, this.targets.blurB);

    const focusPoint =
      this.seatPositions.get(this.selectedSeat ?? "")?.clone() ??
      new THREE.Vector3(0, 0, 0);
    focusPoint.applyMatrix4(this.camera.matrixWorldInverse);

    const compositeUniforms = this.materials.composite.uniforms;
    compositeUniforms.tColor.value = this.targets.color.texture;
    compositeUniforms.tDepth.value = depthTexture;
    compositeUniforms.tAo.value = this.targets.blurB.texture;
    compositeUniforms.uNear.value = this.camera.near;
    compositeUniforms.uFar.value = this.camera.far;
    compositeUniforms.uFocusDepth.value = Math.max(0.1, -focusPoint.z);
    this.renderFullscreen(this.materials.composite, null);
    this.renderer.setRenderTarget(null);
  }
}