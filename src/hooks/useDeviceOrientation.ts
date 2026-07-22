import { useState, useEffect } from "react";

export function useDeviceOrientation() {
  const [heading, setHeading] = useState<number | null>(null);
  const [error] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.DeviceOrientationEvent) {
      setIsSupported(false);
      return;
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      let h = null;

      // iOS devices provide webkitCompassHeading
      if ((event as any).webkitCompassHeading !== undefined) {
        h = (event as any).webkitCompassHeading;
      } else if (event.alpha !== null) {
        // Absolute orientation, alpha is rotation around z axis
        // The compass heading is 360 - alpha
        if ((event as any).absolute) {
          h = 360 - event.alpha;
        } else {
          // If not absolute, we cannot determine true north reliably without additional processing
          // But we'll use 360 - alpha as a relative bearing
          h = 360 - event.alpha;
        }
      }

      if (h !== null) {
        setHeading(h);
      }
    };

    window.addEventListener("deviceorientation", handleOrientation, true);

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, []);

  return { heading, error, isSupported };
}
