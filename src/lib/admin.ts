import { currentUser } from "@clerk/nextjs/server";

const ADMIN_ROLES = new Set(["admin", "super_admin", "superadmin"]);

export async function getAdminUser() {
  const user = await currentUser();

  if (!user) {
    return null;
  }

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
