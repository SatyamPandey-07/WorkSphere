/**
 * Absolute base URL of the deployed app, for links in emails, webhooks and
 * share URLs. Prefers NEXT_PUBLIC_APP_URL, then Vercel's deployment URL.
 */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    const sanitized = explicit.replace(/\/+$/, "");
    return sanitized.startsWith("http://") || sanitized.startsWith("https://")
      ? sanitized
      : `https://${sanitized}`;
  }

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    const sanitized = vercelUrl.replace(/\/+$/, "");
    return sanitized.startsWith("http://") || sanitized.startsWith("https://")
      ? sanitized
      : `https://${sanitized}`;
  }

  return "http://localhost:3000";
}

export function appUrl(path: string): string {
  return `${getAppUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
