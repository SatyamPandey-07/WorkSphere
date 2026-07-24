export async function isWebXRSupported(): Promise<boolean> {
  if (typeof navigator !== "undefined" && "xr" in navigator) {
    try {
      // @ts-expect-error Types missing
      return await navigator.xr.isSessionSupported("immersive-ar");
    } catch {
      return false;
    }
  }
  return false;
}

export async function requestARSession(): Promise<any> {
  if (typeof navigator !== "undefined" && "xr" in navigator) {
    // @ts-expect-error Types missing
    return await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["local-floor"],
    });
  }
  throw new Error("WebXR is not supported on this device or browser.");
}
