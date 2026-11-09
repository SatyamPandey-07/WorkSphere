import React from "react";
import NomadSkillBarterBoard from "@/components/social/NomadSkillBarterBoard";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "On-Site Nomad Skill Barter & Peer Knowledge Exchange | WorkSphere",
  description:
    "Exchange 15-to-30 minute peer knowledge with remote professionals in your workspace. Trade code reviews for visa tips, UI design critiques for growth marketing teardowns.",
};

export default function SkillExchangePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <NomadSkillBarterBoard />
    </main>
  );
}
