import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import AdminPerformanceDashboard from "./AdminPerformanceDashboard";

export const metadata = {
  title: "Performance Telemetry | WorkSphere Admin",
  description:
    "Server cold-start logs, Edge-region request distribution, and Prisma database query metrics for platform performance observability.",
};

export default async function AdminPerformancePage() {
  const admin = await getAdminUser();

  if (!admin) {
    redirect("/");
  }

  return <AdminPerformanceDashboard />;
}
