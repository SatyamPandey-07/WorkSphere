import React from "react";
import PeripheralLockerGrid from "@/components/p2p/PeripheralLockerGrid";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Peer-to-Peer Hardware & Peripheral Lending Locker | WorkSphere",
  description:
    "Borrow secondary 4K displays, high-wattage GaN fast chargers, mechanical keyboards, and noise-canceling headsets from smart lockers on-site.",
};

export default function PeripheralLockerPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <PeripheralLockerGrid />
    </main>
  );
}
