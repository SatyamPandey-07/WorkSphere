import React from "react";
import NomadPassportGallery from "@/components/profile/NomadPassportGallery";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Zero-Knowledge Digital Nomad Passport & Proof of Remote Work | WorkSphere",
  description:
    "Prove your verified workspace streaks and focus hours using Circom Zero-Knowledge SNARKs without revealing private location histories.",
};

export default function NomadPassportPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <NomadPassportGallery />
    </main>
  );
}
