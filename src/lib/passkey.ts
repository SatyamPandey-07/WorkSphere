export const RP_NAME = "WorkSphere";

/**
 * Resolves the Relying Party ID (hostname) from the incoming request.
 */
export function getRpId(req: Request): string {
  const host = req.headers.get("host") || "localhost";
  return host.split(":")[0];
}

/**
 * Resolves the absolute Origin URL from the incoming request.
 */
export function getOrigin(req: Request): string {
  const host = req.headers.get("host") || "localhost:3000";
  const protocol =
    req.headers.get("x-forwarded-proto") ||
    (host.includes("localhost") || host.includes("127.0.0.1")
      ? "http"
      : "https");
  return `${protocol}://${host}`;
}
