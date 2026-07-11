import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import AdminAnalyticsDashboard from "./AdminAnalyticsDashboard";

export const metadata = {
  title: "Admin Analytics | WorkSphere",
  description:
    "Private platform intelligence for search trends, engagement, and venue performance.",
};

export default async function AdminAnalyticsPage() {
  const admin = await getAdminUser();

  if (!admin) {
    redirect("/");
  }

  return <AdminAnalyticsDashboard />;
}
