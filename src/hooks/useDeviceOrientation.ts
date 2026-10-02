import { useState, useEffect, useCallback, useRef } from "react";

export interface DeviceOrientationState {
  heading: number | null;
  error: string | null;
  isSupported: boolean;
  permissionState: "prompt" | "granted" | "denied" | "unsupported";
  requestPermission: () => Promise<boolean>;
}

export function useDeviceOrientation(): DeviceOrientationState {
  const [heading, setHeading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [permissionState, setPermissionState] = useState<
    "prompt" | "granted" | "denied" | "unsupported"
  >("prompt");
  const listenerAttachedRef = useRef(false);

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    let h: number | null = null;

    // iOS Safari provides webkitCompassHeading directly (degrees from true north)
    if (
      (event as any).webkitCompassHeading !== undefined &&
      (event as any).webkitCompassHeading !== null
    ) {
      h = (event as any).webkitCompassHeading;
    } else if (event.alpha !== null && event.alpha !== undefined) {
      // Standard DeviceOrientationEvent: alpha is rotation around z-axis
      // True compass heading = (360 - alpha) % 360
      h = ((360 - event.alpha) % 360 + 360) % 360;
    }

    if (h !== null && !isNaN(h)) {
      setHeading(Math.round(h * 10) / 10);
    }
  }, []);

  const attachListener = useCallback(() => {
    if (listenerAttachedRef.current || typeof window === "undefined") return;

    if ("ondeviceorientationabsolute" in window) {
      window.addEventListener(
        "deviceorientationabsolute" as any,
        handleOrientation,
        true,
      );
    }
    window.addEventListener("deviceorientation", handleOrientation, true);
    listenerAttachedRef.current = true;
  }, [handleOrientation]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hasOrientationSupport =
      "DeviceOrientationEvent" in window || "DeviceMotionEvent" in window;

    if (!hasOrientationSupport) {
      setIsSupported(false);
      setPermissionState("unsupported");
      return;
    }

    setIsSupported(true);

    const DeviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    // iOS 13+ requires user interaction to call requestPermission
    if (typeof DeviceOrientation?.requestPermission === "function") {
      setPermissionState("prompt");
    } else {
      // Non-iOS browsers do not require explicit requestPermission
      setPermissionState("granted");
      attachListener();
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(
          "deviceorientationabsolute" as any,
          handleOrientation,
          true,
        );
        window.removeEventListener(
          "deviceorientation",
          handleOrientation,
          true,
        );
        listenerAttachedRef.current = false;
      }
    };
  }, [attachListener, handleOrientation]);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;

    const DeviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

    if (typeof DeviceOrientation?.requestPermission === "function") {
      try {
        const response = await DeviceOrientation.requestPermission();
        if (response === "granted") {
          setPermissionState("granted");
          setError(null);
          attachListener();
          return true;
        } else {
          setPermissionState("denied");
          setError("Permission to access compass orientation was denied.");
          return false;
        }
      } catch (err: any) {
        setPermissionState("denied");
        setError(
          err?.message || "Failed to request device orientation permission.",
        );
        return false;
      }
    }

    // Automatically granted if not iOS
    setPermissionState("granted");
    setError(null);
    attachListener();
    return true;
  }, [attachListener]);

  return { heading, error, isSupported, permissionState, requestPermission };
}
