export function createSessionSlug(title: string) {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return `${base || "coworking-session"}-${crypto.randomUUID().slice(0, 8)}`;
}

export function getAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const vercel = process.env.VERCEL_URL?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
