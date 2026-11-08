import React from "react";
import type { Metadata } from "next";
import MultiCurrencyDeskCheckout from "@/components/payments/MultiCurrencyDeskCheckout";

export const metadata: Metadata = {
  title: "Multi-Currency Micro-Payments & Lightning/USDC Checkout | WorkSphere",
  description:
    "Real-time per-minute and hourly desk micro-billing with Bitcoin Lightning Network and USDC settlement.",
};

export default function CryptoMicroPayPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Multi-Currency Micro-Payments & Desk Metering
          </h1>
          <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Pay only for the exact minutes you use. Stream payments in real-time using Bitcoin Lightning
            (Satoshis), USDC (Base/Solana), or traditional card payment rails.
          </p>
        </div>

        <MultiCurrencyDeskCheckout />
      </div>
    </div>
  );
}
