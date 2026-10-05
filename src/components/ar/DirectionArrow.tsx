import { useEffect, useRef, useContext } from "react";
import * as THREE from "three";
import { Vector3 as ARVector3 } from "../../types/ar";
import { ARSceneContext } from "./ARScene";

export interface DirectionArrowProps {
  from: ARVector3;
  to: ARVector3;
  targetLabel?: string;
  color?: number;
  showTrail?: boolean;
}

/**
 * Creates an interactive 3D direction arrow mesh group with animated glowing
 * chevrons, floating distance badge, and floor pathway breadcrumbs.
 */
export function create3DDirectionArrowGroup(
  from: THREE.Vector3,
  to: THREE.Vector3,
  targetLabel: string = "Desk",
  customColor: number = 0x8b5cf6, // Violet default
): THREE.Group {
  const group = new THREE.Group();
  group.userData.isDirectionArrow = true;

  const dir = new THREE.Vector3().subVectors(to, from);
  const distance = Math.max(0.1, dir.length());
  dir.normalize();

  // Proximity-based color (emerald when close, violet/cyan when further)
  const isNear = distance < 1.5;
  const arrowColor = isNear ? 0x10b981 : customColor;

  // 1. Primary Floating Arrow Mesh (Forward Pointer)
  const arrowHeadGeo = new THREE.ConeGeometry(0.12, 0.28, 16);
  const arrowShaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.35, 16);

  const arrowMat = new THREE.MeshStandardMaterial({
    color: arrowColor,
    emissive: arrowColor,
    emissiveIntensity: 0.6,
    roughness: 0.2,
    metalness: 0.8,
  });

  const arrowHead = new THREE.Mesh(arrowHeadGeo, arrowMat);
  arrowHead.rotation.x = Math.PI / 2;
  arrowHead.position.z = 0.25;

  const arrowShaft = new THREE.Mesh(arrowShaftGeo, arrowMat);
  arrowShaft.rotation.x = Math.PI / 2;
  arrowShaft.position.z = -0.05;

  const mainArrow = new THREE.Group();
  mainArrow.add(arrowHead);
  mainArrow.add(arrowShaft);

  // Position arrow 1.2m ahead of user camera along line of sight to target
  const arrowOffset = Math.min(1.2, distance * 0.4);
  const arrowPos = new THREE.Vector3().copy(from).addScaledVector(dir, arrowOffset);
  arrowPos.y = Math.max(0.3, from.y - 0.2); // slight downward angle for natural viewing
  mainArrow.position.copy(arrowPos);
  mainArrow.lookAt(to);
  group.add(mainArrow);

  // 2. Floating Distance & Target Badge Sprite
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Pill background
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.beginPath();
    ctx.roundRect(16, 16, canvas.width - 32, canvas.height - 32, 32);
    ctx.fill();

    // Glowing border
    ctx.strokeStyle = isNear ? "#10b981" : "#8b5cf6";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(16, 16, canvas.width - 32, canvas.height - 32, 32);
    ctx.stroke();

    // Text Label
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const distText = distance < 1.0 ? "Arrived!" : `${targetLabel} • ${distance.toFixed(1)}m`;
    ctx.fillText(distText, canvas.width / 2, canvas.height / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const labelSprite = new THREE.Sprite(spriteMat);
  labelSprite.scale.set(0.75, 0.2, 1);
  labelSprite.position.set(arrowPos.x, arrowPos.y + 0.35, arrowPos.z);
  group.add(labelSprite);

  // 3. Segmented Floor Breadcrumb Trail (Chevrons leading to target desk)
  const trailSegments = Math.min(8, Math.max(2, Math.floor(distance / 0.8)));
  const chevronGeo = new THREE.ConeGeometry(0.08, 0.16, 3);
  const chevronMat = new THREE.MeshBasicMaterial({
    color: arrowColor,
    transparent: true,
    opacity: 0.75,
  });

  for (let i = 1; i <= trailSegments; i++) {
    const fraction = i / (trailSegments + 1);
    const stepPos = new THREE.Vector3().lerpVectors(from, to, fraction);
    stepPos.y = 0.05; // grounded slightly above floor

    const chevron = new THREE.Mesh(chevronGeo, chevronMat);
    chevron.position.copy(stepPos);
    chevron.lookAt(new THREE.Vector3(to.x, 0.05, to.z));
    chevron.rotateX(Math.PI / 2);
    chevron.userData.trailIndex = i;
    group.add(chevron);
  }

  group.userData.mainArrow = mainArrow;
  group.userData.labelSprite = labelSprite;
  group.userData.distance = distance;
  group.userData.isNear = isNear;

  return group;
}

/**
 * React Component for rendering 3D direction arrows inside an ARScene context.
 */
export function DirectionArrow({ from, to, targetLabel = "Desk", customColor = 0x8b5cf6 }: DirectionArrowProps & { customColor?: number }) {
  const scene = useContext(ARSceneContext);
  const arrowGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    if (!scene) return;

    const fromVec = new THREE.Vector3(from.x, from.y, from.z);
    const toVec = new THREE.Vector3(to.x, to.y, to.z);

    if (arrowGroupRef.current) {
      scene.remove(arrowGroupRef.current);
      disposeHierarchy(arrowGroupRef.current);
      arrowGroupRef.current = null;
    }

    const newGroup = create3DDirectionArrowGroup(fromVec, toVec, targetLabel, customColor);
    arrowGroupRef.current = newGroup;
    scene.add(newGroup);

    return () => {
      if (arrowGroupRef.current) {
        scene.remove(arrowGroupRef.current);
        disposeHierarchy(arrowGroupRef.current);
        arrowGroupRef.current = null;
      }
    };
  }, [scene, from.x, from.y, from.z, to.x, to.y, to.z, targetLabel, customColor]);

  return null;
}

function disposeHierarchy(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    } else if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  });
}
