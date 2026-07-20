import { currentUser } from "@clerk/nextjs/server";

const ADMIN_ROLES = new Set(["admin", "super_admin", "superadmin"]);

export async function getAdminUser() {
  const user = await currentUser();

  if (!user) {
    return null;
  }

  // 1. Check env-configured admin emails (comma-separated: e.g. ADMIN_EMAILS="admin@example.com,you@domain.com")
  const adminEmails = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.length > 0) {
    const userEmails = user.emailAddresses?.map((e) => e.emailAddress.toLowerCase()) ?? [];
    if (userEmails.some((email) => adminEmails.includes(email))) {
      return user;
    }
  }

  // 2. Check Clerk metadata role
  const publicRole =
    typeof user.publicMetadata?.role === "string"
      ? user.publicMetadata.role
      : undefined;

  const privateRole =
    typeof user.privateMetadata?.role === "string"
      ? user.privateMetadata.role
      : undefined;

  const role = (privateRole ?? publicRole ?? "").toLowerCase();

  return ADMIN_ROLES.has(role) ? user : null;
}
