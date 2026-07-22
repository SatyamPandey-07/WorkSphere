import { useState, useEffect, useCallback, useRef } from "react";

export interface PersistentAnchor {
  id: string;
  persistId: string;
  position: DOMPointInit;
  orientation: DOMPointInit;
  matrix: Float32Array;
}

export function useWebXR() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [anchorsSupported, setAnchorsSupported] = useState(false);
  const sessionRef = useRef<XRSession | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "xr" in navigator) {
      (navigator as any).xr
        ?.isSessionSupported("immersive-ar")
        .then((supported: boolean) => {
          setIsSupported(supported);
        })
        .catch(() => {
          setIsSupported(false);
        });
    } else {
      setIsSupported(false);
    }
  }, []);

  const requestSession = useCallback(async (): Promise<XRSession | null> => {
    if (!isSupported || !("xr" in navigator)) return null;

    try {
      const session = await (navigator as any).xr.requestSession(
        "immersive-ar",
        {
          requiredFeatures: ["local", "anchors"],
          optionalFeatures: ["dom-overlay", "plane-detection"],
          domOverlay: { root: document.body },
        },
      );
      sessionRef.current = session;
      setAnchorsSupported(true);

      session.addEventListener("end", () => {
        sessionRef.current = null;
        setAnchorsSupported(false);
      });

      return session;
    } catch (error) {
      console.error("Error requesting WebXR session", error);

      try {
        const session = await (navigator as any).xr.requestSession(
          "immersive-ar",
          {
            requiredFeatures: ["local"],
            optionalFeatures: ["dom-overlay"],
            domOverlay: { root: document.body },
          },
        );
        sessionRef.current = session;
        setAnchorsSupported(false);

        session.addEventListener("end", () => {
          sessionRef.current = null;
          setAnchorsSupported(false);
        });

        return session;
      } catch (fallbackError) {
        console.error("Fallback session also failed", fallbackError);
        return null;
      }
    }
  }, [isSupported]);

  const createAnchor = useCallback(
    async (
      referenceSpace: XRReferenceSpace,
      position: DOMPointInit,
      orientation: DOMPointInit,
    ): Promise<PersistentAnchor | null> => {
      const session = sessionRef.current;
      if (!session || !anchorsSupported) return null;

      try {
        const anchor = await (session as any).requestAnchor(
          position,
          orientation,
        );
        const persistId = await anchor.requestPersistent();

        const matrix = new Float32Array(16);
        const transform = (anchor as any).getTransform(referenceSpace);
        if (transform) {
          matrix.set(transform.matrix);
        }

        return {
          id: crypto.randomUUID(),
          persistId,
          position,
          orientation,
          matrix,
        };
      } catch (error) {
        console.error("Failed to create persistent anchor:", error);
        return null;
      }
    },
    [anchorsSupported],
  );

  const restoreAnchor = useCallback(
    async (
      referenceSpace: XRReferenceSpace,
      persistId: string,
    ): Promise<PersistentAnchor | null> => {
      const session = sessionRef.current;
      if (!session || !anchorsSupported) return null;

      try {
        const anchor = await (session as any).requestPersistentAnchor(
          persistId,
        );
        if (!anchor) return null;

        const matrix = new Float32Array(16);
        const transform = (anchor as any).getTransform(referenceSpace);
        if (transform) {
          matrix.set(transform.matrix);
        }

        return {
          id: crypto.randomUUID(),
          persistId,
          position: transform?.position ?? { x: 0, y: 0, z: 0, w: 1 },
          orientation: transform?.orientation ?? { x: 0, y: 0, z: 0, w: 1 },
          matrix,
        };
      } catch (error) {
        console.error("Failed to restore persistent anchor:", error);
        return null;
      }
    },
    [anchorsSupported],
  );

  const getAnchorMatrix = useCallback(
    (
      referenceSpace: XRReferenceSpace,
      anchorSpace: XRSpace,
    ): Float32Array | null => {
      try {
        const transform = (anchorSpace as any).getTransform(referenceSpace);
        if (!transform) return null;
        const matrix = new Float32Array(16);
        matrix.set(transform.matrix);
        return matrix;
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    isSupported,
    anchorsSupported,
    requestSession,
    createAnchor,
    restoreAnchor,
    getAnchorMatrix,
  };
}
