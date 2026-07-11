import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import SocialWorkspaceClient from "./social-workspace-client";

export const metadata = {
  title: "Work Together | WorkSphere",
  description: "Share work status and plan coworking sessions with your people.",
};

export default async function SocialPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return <SocialWorkspaceClient />;
}
