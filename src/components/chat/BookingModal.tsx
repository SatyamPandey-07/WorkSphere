"use client";

import {
    X, ShieldCheck, Zap, CheckCircle2,
    ArrowRight, Loader2, Lock, Banknote, Landmark,
    Calendar, Clock, User, Download, ExternalLink,
    MapPin, ChevronRight, Inbox, CreditCard
} from "lucide-react";
import { useState, useEffect } from "react";
import { Venue } from "./ChatMessages";
import { trackEvent } from "@/lib/analytics";

interface Booking {
    id: string;
    confirmationId: string;
    date: string;
    time: string;
    venue: {
        name: string;
        category: string;
        address: string;
    };
    createdAt: string;
}

interface BookingModalProps {
    venue: Venue | null;
    isOpen: boolean;
    onClose: () => void;
    mode?: "booking" | "history";
}

export function BookingModal({ venue, isOpen, onClose, mode = "booking" }: BookingModalProps) {
    const [step, setStep] = useState<"details" | "payment" | "processing" | "success" | "history">("details");
    const [bookingDate, setBookingDate] = useState("");
    const [bookingTime, setBookingTime] = useState("");
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [history, setHistory] = useState<Booking[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    useEffect(() => {
        if (!isOpen) {
            setStep(mode === "history" ? "history" : "details");
        } else if (mode === "history") {
            fetchHistory();
        }
    }, [isOpen, mode]);

    const fetchHistory = async () => {
        setLoadingHistory(true);
        try {
            const res = await fetch("/api/bookings/history");
            const data = await res.json();
            setHistory(data.bookings || []);
            setStep("history");
        } catch (err) {
            console.error("Failed to fetch history:", err);
        } finally {
            setLoadingHistory(false);
        }
    };

    if (!isOpen) return null;

    const handleBooking = async () => {
        setStep("processing");
        trackEvent("venue_rated", { venueId: venue?.id || "unknown", venueName: venue?.name || "unknown", action: "booking_started" });

        try {
            const response = await fetch("/api/bookings/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    venue,
                    date: bookingDate,
                    time: bookingTime,
                    customerEmail: email,
                    customerPhone: phone
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.details || errorData.error || "Signal transmission failed");
            }

            setStep("success");
            trackEvent("venue_rated", { venueId: venue?.id || "unknown", venueName: venue?.name || "unknown", action: "booking_confirmed" });
        } catch (err: any) {
            console.error("Booking failure details:", err);
            setStep("details");
            alert(`NEURAL SIGNAL ERROR: ${err.message}`);
        }
    };

    return (
        <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4 bg-zinc-950/90 animate-in fade-in duration-300 backdrop-blur-sm">
            <div
                className="bg-white dark:bg-zinc-900 w-full max-w-2xl overflow-hidden rounded-[2.5rem] shadow-[0_20px_100px_rgba(0,0,0,0.9)] border border-zinc-200 dark:border-zinc-800 animate-in zoom-in-95 duration-300"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-8 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-800/30">
                    <div>
                        <h2 className="text-2xl font-black uppercase tracking-tighter">
                            {step === "history" ? "Neural Ledger" : "Secure Booking"}
                        </h2>
                        <div className="flex items-center gap-1.5 text-[10px] font-black text-blue-500 uppercase tracking-widest mt-0.5">
                            <ShieldCheck className="w-3 h-3" />
                            {step === "history" ? "Archived Signal Chain" : "Neural Encryption Active"}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-2xl transition-all active:scale-90">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8">
                    {step === "history" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {loadingHistory ? (
                                <div className="py-20 flex flex-col items-center justify-center gap-4">
                                    <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Retrieving Archived Signals...</p>
                                </div>
                            ) : history.length === 0 ? (
                                <div className="py-20 flex flex-col items-center justify-center text-center space-y-4">
                                    <div className="w-20 h-20 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                                        <Inbox className="w-10 h-10 text-zinc-300" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-black uppercase tracking-tight">No Active Residencies</h3>
                                        <p className="text-xs text-zinc-500 font-bold max-w-[280px]">Your neural ledger is empty. Book a workspace to begin your history.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                    {history.map((booking) => (
                                        <div
                                            key={booking.id}
                                            className="group relative bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-3xl p-6 hover:border-blue-500/50 transition-all hover:shadow-xl hover:shadow-blue-500/5"
                                        >
                                            <div className="flex justify-between items-start mb-4">
                                                <div>
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-[8px] font-black bg-blue-600 text-white px-2 py-0.5 rounded uppercase tracking-widest">
                                                            {booking.venue.category}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                                                            {booking.confirmationId}
                                                        </span>
                                                    </div>
                                                    <h4 className="text-lg font-black uppercase tracking-tight group-hover:text-blue-500 transition-colors">
                                                        {booking.venue.name}
                                                    </h4>
                                                    <p className="text-[10px] text-zinc-500 font-bold flex items-center gap-1 uppercase tracking-widest mt-1">
                                                        <MapPin className="w-3 h-3" />
                                                        {booking.venue.address}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm font-black text-zinc-900 dark:text-zinc-100">{booking.date}</p>
                                                    <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{booking.time}</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                                                <button className="flex-1 flex items-center justify-center gap-2 py-3 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all active:scale-95">
                                                    <Download className="w-3.5 h-3.5" />
                                                    Download Receipt
                                                </button>
                                                <button className="p-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl hover:bg-zinc-50 transition-colors">
                                                    <ExternalLink className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {step === "details" && venue && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center gap-4 p-6 bg-zinc-900 dark:bg-blue-600 rounded-[2rem] text-white shadow-2xl relative overflow-hidden group">
                                <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-125 transition-transform duration-700">
                                    <Zap className="w-32 h-32" />
                                </div>
                                <div className="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shadow-lg border border-white/30">
                                    <Zap className="w-8 h-8" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black text-white/60 uppercase tracking-widest mb-1">Target Workspace Hub</p>
                                    <h3 className="text-xl font-black uppercase truncate tracking-tight">{venue.name}</h3>
                                    <p className="text-[10px] text-white/40 font-bold truncate uppercase tracking-widest">{venue.address}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-2">Allocation Date</label>
                                    <div className="relative">
                                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                        <input
                                            type="date"
                                            className="w-full pl-12 pr-6 py-4 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-100 dark:border-zinc-700 rounded-[1.25rem] text-sm font-bold focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                            value={bookingDate}
                                            onChange={(e) => setBookingDate(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-2">Arrival Time</label>
                                    <div className="relative">
                                        <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                        <input
                                            type="time"
                                            className="w-full pl-12 pr-6 py-4 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-100 dark:border-zinc-700 rounded-[1.25rem] text-sm font-bold focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                            value={bookingTime}
                                            onChange={(e) => setBookingTime(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-2">Neural Link ID (Email)</label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                                        <input
                                            type="email"
                                            placeholder="you@example.com"
                                            className="w-full pl-12 pr-6 py-4 bg-zinc-50 dark:bg-zinc-800 border-2 border-zinc-100 dark:border-zinc-700 rounded-[1.25rem] text-sm font-bold focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => setStep("payment")}
                                disabled={!bookingDate || !bookingTime || !email}
                                className="w-full bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-950 font-black uppercase tracking-widest py-5 rounded-[1.5rem] flex items-center justify-center gap-3 hover:scale-[1.02] transition-all active:scale-95 disabled:opacity-50 disabled:hover:scale-100 shadow-2xl shadow-zinc-900/10"
                            >
                                Continue to Security Check
                                <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    )}

                    {step === "payment" && (
                        <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                            {/* Visual Card Representation */}
                            <div className="p-8 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:scale-150 transition-transform duration-1000">
                                    <Lock className="w-48 h-48" />
                                </div>
                                <div className="relative">
                                    <div className="flex justify-between items-start mb-12">
                                        <div className="p-3 bg-white/20 backdrop-blur-md rounded-xl border border-white/30">
                                            <CreditCard className="w-8 h-8" />
                                        </div>
                                        <span className="text-[10px] font-black uppercase tracking-[0.4em] opacity-80">Workspace ID Pass</span>
                                    </div>
                                    <div className="text-3xl font-mono tracking-[0.25em] mb-12 drop-shadow-lg">**** **** **** 4242</div>
                                    <div className="flex justify-between items-end">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Residency Holder</p>
                                            <p className="text-sm font-black uppercase tracking-[0.1em]">WORKSPHERE MEMBER</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] uppercase tracking-widest opacity-60 mb-1">Valid Thru</p>
                                            <p className="text-sm font-black uppercase tracking-[0.1em]">12/28</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4 px-2">
                                <div className="flex items-center justify-between text-sm font-black border-b border-zinc-100 dark:border-zinc-800 pb-4">
                                    <span className="text-zinc-400 uppercase tracking-widest text-[10px]">Neural Session Overhead</span>
                                    <span className="text-zinc-900 dark:text-zinc-100">$0.00</span>
                                </div>
                                <div className="flex items-center justify-between text-2xl font-black pt-2">
                                    <span className="uppercase tracking-tighter">Total Signal Weight</span>
                                    <span className="text-blue-500">$0.00</span>
                                </div>
                            </div>

                            <button
                                onClick={handleBooking}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-widest py-6 rounded-[1.5rem] flex items-center justify-center gap-3 shadow-2xl shadow-green-500/20 hover:scale-[1.02] transition-all active:scale-95"
                            >
                                <Lock className="w-5 h-5 shadow-inner" />
                                Finalize Secure Protocol
                            </button>
                        </div>
                    )}

                    {step === "processing" && (
                        <div className="py-24 flex flex-col items-center justify-center space-y-8 animate-in fade-in duration-500">
                            <div className="relative">
                                <div className="w-24 h-24 rounded-full border-4 border-zinc-100 dark:border-zinc-800"></div>
                                <div className="absolute top-0 left-0 w-24 h-24 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
                                <Lock className="absolute inset-0 m-auto w-8 h-8 text-blue-600 animate-pulse" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-black uppercase tracking-widest mb-2">Synchronizing Neural Ledger</h3>
                                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em] animate-pulse">Allocating Physical Seat...</p>
                            </div>
                        </div>
                    )}

                    {step === "success" && venue && (
                        <div className="py-16 flex flex-col items-center justify-center space-y-10 animate-in zoom-in-95 duration-500">
                            <div className="w-32 h-32 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 border-8 border-green-500/5 shadow-[0_0_60px_rgba(34,197,94,0.2)] scale-110">
                                <CheckCircle2 className="w-16 h-16" />
                            </div>
                            <div className="text-center space-y-4">
                                <h3 className="text-3xl font-black uppercase tracking-tighter">Residency Secured</h3>
                                <p className="text-sm text-zinc-500 font-bold max-w-[320px] mx-auto leading-relaxed">
                                    Your spot at <span className="text-zinc-900 dark:text-zinc-100 font-black underline decoration-blue-500 decoration-2 underline-offset-4">{venue.name}</span> is now yours.
                                    A professional PDF receipt has been dispatched to your neural ID.
                                </p>
                            </div>

                            <button
                                onClick={onClose}
                                className="w-full border-2 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800 font-black uppercase tracking-widest py-5 rounded-[1.5rem] transition-all active:scale-95"
                            >
                                Return to Global Hub
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer Badges */}
                <div className="px-8 py-6 bg-zinc-50/80 dark:bg-zinc-800/50 flex items-center justify-center gap-8 border-t border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2 opacity-50 bg-white dark:bg-zinc-900 px-4 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700">
                        <Landmark className="w-4 h-4" />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em]">Validated Tier-1 Ledger</span>
                    </div>
                    <div className="flex items-center gap-2 opacity-50 bg-white dark:bg-zinc-900 px-4 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700">
                        <Banknote className="w-4 h-4" />
                        <span className="text-[9px] font-black uppercase tracking-[0.2em]">Zero-Fee Extraction</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
