import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import AdminEmailDashboard from "./AdminEmailDashboard";

export const metadata = {
  title: "Admin Email Dashboard | WorkSphere",
  description: "Monitor SMTP delivery, verification queues, and email logs.",
};

export default async function AdminEmailsPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/");
  return <AdminEmailDashboard />;
}
