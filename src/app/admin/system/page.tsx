import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import AdminSystemDashboard from "./AdminSystemDashboard";

export const metadata = {
  title: "System Health | WorkSphere Admin",
  description:
    "Private operational view of platform usage volume, AI agent execution times, and database query latency.",
};

export default async function AdminSystemPage() {
  const admin = await getAdminUser();

  if (!admin) {
    redirect("/");
  }

  return <AdminSystemDashboard />;
}