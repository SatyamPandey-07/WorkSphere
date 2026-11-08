import React from "react";
import WebXRDeskFinderView from "@/components/ar/WebXRDeskFinderView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WebXR Indoor AR Wayfinding & Desk Finder | WorkSphere",
  description:
    "Navigate complex coworking spaces with camera-driven Augmented Reality waypoints and spatial anchor guidance to your reserved desk.",
};

export default function ARFinderPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <WebXRDeskFinderView />
    </main>
  );
}
