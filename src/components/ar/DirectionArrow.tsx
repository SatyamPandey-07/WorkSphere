import { useEffect, useRef, useContext } from "react";
import * as THREE from "three";
import { Vector3 as ARVector3 } from "../../types/ar";
import { ARSceneContext } from "./ARScene";

interface Props {
  from: ARVector3;
  to: ARVector3;
}

export function DirectionArrow({ from, to }: Props) {
  const scene = useContext(ARSceneContext);
  const arrowHelperRef = useRef<THREE.ArrowHelper | null>(null);

  useEffect(() => {
    if (!scene) return;

    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
    let length = dir.length();
    if (length === 0) length = 0.001;
    dir.normalize();

    const origin = new THREE.Vector3(from.x, from.y, from.z);
    const hex = 0x3b82f6; // blue color for arrow

    if (!arrowHelperRef.current) {
      arrowHelperRef.current = new THREE.ArrowHelper(
        dir,
        origin,
        length,
        hex,
        Math.min(0.5, length * 0.2),
        Math.min(0.2, length * 0.1),
      );
      scene.add(arrowHelperRef.current);
    } else {
      arrowHelperRef.current.setDirection(dir);
      arrowHelperRef.current.setLength(
        length,
        Math.min(0.5, length * 0.2),
        Math.min(0.2, length * 0.1),
      );
      arrowHelperRef.current.position.copy(origin);
    }

    return () => {
      if (arrowHelperRef.current) {
        scene.remove(arrowHelperRef.current);
        arrowHelperRef.current.dispose();
        arrowHelperRef.current = null;
      }
    };
  }, [scene, from, to]);

  return null;
}
