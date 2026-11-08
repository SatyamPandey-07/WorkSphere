import React from "react";
import TeamMeetHalfwayLobby from "@/components/social/TeamMeetHalfwayLobby";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team Coworking Meet Halfway & Geo-Clustering | WorkSphere",
  description:
    "Equitably balance commute times across your distributed team, find contiguous workspace seats, vote in real-time, and split booking costs.",
};

export default function MeetHalfwayPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-8">
      <TeamMeetHalfwayLobby />
    </main>
  );
}
