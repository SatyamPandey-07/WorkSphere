"use client";

import { useEffect, useState, use } from "react";
import {
  CreditCard,
  CheckCircle2,
  Lock,
  Calendar,
  Clock,
  MapPin,
  Wifi,
  Sparkles,
  QrCode,
  Download,
  AlertCircle,
  Loader2,
  ShieldCheck,
  User,
  Coffee,
} from "lucide-react";
import { downloadICS } from "@/lib/calendar";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default function GuestSplitPaymentPage({ params }: PageProps) {
  const { token } = use(params);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paidPass, setPaidPass] = useState<any>(null);

  useEffect(() => {
    async function loadDetails() {
      try {
        const res = await fetch(`/api/pay/split/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || "Invalid or expired payment link");
        }
        setData(json);
        if (json.isPaid) {
          setPaidPass({
            passCode: `GP-${json.payload.bookingId.slice(-4).toUpperCase()}-${json.payload.guestId.slice(-4).toUpperCase()}`,
            guestName: json.payload.name || json.payload.email,
            venueName: json.venue?.name || json.payload.venueName,
            date: json.bookingDetails.date,
            time: json.bookingDetails.time,
            amountPaid: json.payload.amount,
            currency: json.payload.currency,
            wifiAccessCode: "WorkSphere-HighSpeed-Guest",
            accessLevel: "Full Coworking & Meeting Access",
          });
        }
      } catch (err: any) {
        setError(err.message || "Could not load split payment details");
      } finally {
        setLoading(false);
      }
    }
    loadDetails();
  }, [token]);

  const handlePay = async () => {
    setPaying(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/split/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Payment failed");
      }
      setPaidPass(json.guestPass);
    } catch (err: any) {
      setError(err.message || "Payment processing error");
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4 text-zinc-400">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <p className="text-sm">Loading your guest pass details...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-zinc-900 p-6 text-center space-y-3">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-white">Payment Link Unavailable</h2>
          <p className="text-sm text-zinc-400">{error}</p>
        </div>
      </div>
    );
  }

  const { payload, venue, hostName, bookingDetails } = data;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" /> WorkSphere Guest Pass
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
            {paidPass ? "Your Guest Pass is Ready!" : "Join Workspace Session"}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400">
            Invited by <span className="text-white font-medium">{hostName}</span>
          </p>
        </div>

        {/* Digital Guest Pass Card (Post-Payment) */}
        {paidPass ? (
          <div className="rounded-3xl border border-emerald-500/40 bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div>
                <span className="text-[10px] font-mono font-bold tracking-widest uppercase text-emerald-400">
                  Confirmed Access Pass
                </span>
                <h3 className="text-xl font-bold text-white mt-0.5">
                  {paidPass.venueName}
                </h3>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            {/* Pass QR & Passcode */}
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-black/40 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-16 w-16 rounded-xl bg-white p-2 flex items-center justify-center shadow-md">
                  <QrCode className="w-full h-full text-zinc-900" />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                    Digital Pass Code
                  </span>
                  <div className="font-mono text-base font-bold text-emerald-300 tracking-wider">
                    {paidPass.passCode}
                  </div>
                  <span className="text-xs text-zinc-400">Present at front desk</span>
                </div>
              </div>
              <div className="text-right sm:border-l sm:border-zinc-800 sm:pl-4">
                <span className="text-[10px] text-zinc-500 uppercase font-semibold">
                  Paid Amount
                </span>
                <div className="text-lg font-bold text-white">
                  ${paidPass.amountPaid.toFixed(2)} {paidPass.currency}
                </div>
              </div>
            </div>

            {/* Session Logistics */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-zinc-800/50 p-3 space-y-1">
                <span className="flex items-center gap-1 text-zinc-400">
                  <Calendar className="w-3.5 h-3.5 text-zinc-500" /> Date &amp; Time
                </span>
                <div className="font-semibold text-white">
                  {paidPass.date} · {paidPass.time}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-800/50 p-3 space-y-1">
                <span className="flex items-center gap-1 text-zinc-400">
                  <Wifi className="w-3.5 h-3.5 text-zinc-500" /> Guest WiFi
                </span>
                <div className="font-mono font-semibold text-emerald-300">
                  {paidPass.wifiAccessCode}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() =>
                  downloadICS(
                    paidPass.venueName,
                    venue?.address || "",
                    paidPass.date,
                    paidPass.time,
                    bookingDetails.duration || 60,
                    paidPass.passCode,
                  )
                }
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition-colors"
              >
                <Download className="w-4 h-4" />
                Add to Calendar (.ics)
              </button>
            </div>
          </div>
        ) : (
          /* Payment Checkout Card */
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6 sm:p-8 shadow-2xl space-y-6 backdrop-blur-md">
            {/* Venue & Booking Summary */}
            <div className="space-y-3 border-b border-zinc-800 pb-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-white">
                    {venue?.name || payload.venueName}
                  </h3>
                  {venue?.address && (
                    <p className="text-xs text-zinc-400 flex items-center gap-1 mt-1">
                      <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      {venue.address}
                    </p>
                  )}
                </div>
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400">
                  <Coffee className="w-5 h-5" />
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-zinc-300 pt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                  {bookingDetails.date}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-zinc-500" />
                  {bookingDetails.time} ({bookingDetails.duration} min)
                </span>
              </div>
            </div>

            {/* Split Share Breakdown */}
            <div className="rounded-2xl bg-zinc-950 p-4 border border-zinc-800/80 space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-400">Guest Pass Attendee:</span>
                <span className="font-semibold text-zinc-200">
                  {payload.name || payload.email}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-400">Workspace Amenities:</span>
                <span className="text-emerald-400 font-medium">Included (High-Speed WiFi &amp; Desk)</span>
              </div>
              <div className="flex justify-between items-center text-sm border-t border-zinc-800/80 pt-2 font-bold">
                <span className="text-white">Your Split Share:</span>
                <span className="text-xl text-emerald-400 font-mono">
                  ${payload.amount.toFixed(2)} {payload.currency}
                </span>
              </div>
            </div>

            {/* Checkout Action */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={handlePay}
                disabled={paying}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all cursor-pointer disabled:opacity-50"
              >
                {paying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing Payment...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Pay ${payload.amount.toFixed(2)} &amp; Unlock Guest Pass
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 text-[11px] text-zinc-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                <span>Instant 256-bit encrypted checkout &amp; pass issuance</span>
              </div>
            </div>

            {error && (
              <p className="text-xs text-rose-400 text-center">{error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
