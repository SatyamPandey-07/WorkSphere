import { timingSafeEqual } from "crypto";

/**
 * Authorizes scheduled-job requests (Vercel Cron, GitHub Actions, etc.).
 *
 * Callers must send `Authorization: Bearer <CRON_SECRET>`. When CRON_SECRET is
 * unset the endpoint is open only outside production, so local development can
 * trigger jobs without extra setup while production fails closed.
 */
export function isAuthorizedCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
