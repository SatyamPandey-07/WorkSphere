import React from "react";
import AmbientCoworkingCircle from "@/components/social/AmbientCoworkingCircle";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ambient Virtual Coworking Circle & Pomodoro Sync | WorkSphere",
  description:
    "Synchronized Pomodoro sprints, spatial audio soundscapes (Rain, Cafe, 14Hz Alpha Beats), and shared sprint accountability with remote coworkers.",
};

export default function FocusRoomPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <AmbientCoworkingCircle />
    </main>
  );
}
