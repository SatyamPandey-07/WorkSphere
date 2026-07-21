import { useState, useEffect, useCallback } from "react";

export function useWebXR() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

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
          requiredFeatures: ["local"],
          optionalFeatures: ["dom-overlay"],
          domOverlay: { root: document.body },
        },
      );
      return session;
    } catch (error) {
      console.error("Error requesting WebXR session", error);
      return null;
    }
  }, [isSupported]);

  return { isSupported, requestSession };
}
