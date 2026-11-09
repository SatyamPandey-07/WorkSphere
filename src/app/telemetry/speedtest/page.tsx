import React from "react";
import ProofOfBandwidthModal from "@/components/wifi/ProofOfBandwidthModal";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wi-Fi Proof-of-Bandwidth & RFC 3550 Jitter Verifier | WorkSphere",
  description:
    "Test and certify your workspace Wi-Fi throughput, latency, and packet jitter for 4K video calling and high-bandwidth remote engineering.",
};

export default function SpeedTestPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <ProofOfBandwidthModal />
    </main>
  );
}
