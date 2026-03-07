"use client";

import { useEffect, useState } from "react";
import {
    Users,
    MapPin,
    Star,
    Heart,
    Zap,
    Clock,
    ArrowUpRight,
    ShieldCheck,
    RefreshCw,
    Calendar,
    ArrowLeft,
    Download,
    Mail,
    User as UserIcon,
    History,
    ExternalLink
} from "lucide-react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";

interface UserAnalytics {
    profile: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        joinedAt: string;
    };
    summary: {
        totalResidencies: number;
        totalFavorites: number;
        totalRatings: number;
        totalConversations: number;
    };
    history: {
        bookings: any[];
        favorites: any[];
        ratings: any[];
    };
}

export default function AnalyticsDashboard() {
    const { user: clerkUser } = useUser();
    const [data, setData] = useState<UserAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);

    const fetchUserStats = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/analytics");
            const json = await res.json();
            setData(json);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadReceipt = async (bookingId: string, confirmationId: string) => {
        setDownloadingId(bookingId);
        try {
            const response = await fetch(`/api/bookings/${bookingId}/download`);
            
            if (!response.ok) {
                throw new Error("Failed to download receipt");
            }

            // Create blob from response
            const blob = await response.blob();
            
            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `WorkSphere_Receipt_${confirmationId}.pdf`;
            document.body.appendChild(a);
            a.click();
            
            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            console.log("[Download] Receipt downloaded successfully");
        } catch (error) {
            console.error("[Download Error]:", error);
            alert("Failed to download receipt. Please try again.");
        } finally {
            setDownloadingId(null);
        }
    };

    const handleViewVenue = (venue: { name: string; latitude?: number; longitude?: number; category: string }) => {
        // Check if venue has coordinates
        if (!venue.latitude || !venue.longitude) {
            alert("Venue location not available");
            return;
        }
        
        // Navigate to AI dashboard with venue coordinates in URL
        const params = new URLSearchParams({
            venue: venue.name,
            lat: venue.latitude.toString(),
            lng: venue.longitude.toString(),
            category: venue.category
        });
        window.open(`/ai?${params.toString()}`, '_blank');
    };

    useEffect(() => {
        fetchUserStats();
    }, []);

    if (loading && !data) {
        return (
            <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <RefreshCw className="w-12 h-12 text-blue-600 animate-spin" />
                    <div className="text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Decrypting Neural Identity...</p>
                        <p className="text-[8px] font-bold text-zinc-400 mt-2 uppercase tracking-widest animate-pulse">Syncing Cloud Ledger</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 font-sans selection:bg-blue-500 selection:text-white">
            <div className="max-w-7xl mx-auto p-6 md:p-12 space-y-12">

                {/* Navigation & User Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                    <div className="space-y-4">
                        <Link
                            href="/ai"
                            className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-blue-600 transition-colors group"
                        >
                            <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
                            Back to Core Hub
                        </Link>
                        <div className="flex items-center gap-4">
                            <div className="w-20 h-20 rounded-[2rem] bg-gradient-to-br from-blue-600 to-indigo-700 p-0.5 shadow-2xl shadow-blue-500/20">
                                <div className="w-full h-full rounded-[1.9rem] bg-white dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
                                    {clerkUser?.imageUrl ? (
                                        <img src={clerkUser.imageUrl} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        <UserIcon className="w-8 h-8 text-zinc-400" />
                                    )}
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="px-2 py-0.5 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 text-[8px] font-black uppercase tracking-[0.2em] rounded">
                                        VERIFIED MEMBER
                                    </span>
                                    <span className="flex items-center gap-1 text-[8px] font-black text-blue-500 uppercase tracking-widest">
                                        <ShieldCheck className="w-3 h-3" />
                                        Neural Link Active
                                    </span>
                                </div>
                                <h1 className="text-4xl font-black uppercase tracking-tighter leading-none">
                                    {data?.profile.firstName || 'Neural'} <span className="text-blue-600">{data?.profile.lastName || 'Profile'}</span>
                                </h1>
                                <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest mt-2 flex items-center gap-2">
                                    <Mail className="w-3 h-3" /> {data?.profile.email}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchUserStats}
                            className="p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:bg-zinc-50 transition-all active:scale-95 shadow-sm"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <div className="h-10 w-px bg-zinc-200 dark:bg-zinc-800 mx-2" />
                        <div className="text-right hidden lg:block">
                            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest leading-none mb-1">Total Residencies</p>
                            <p className="text-2xl font-black text-zinc-900 dark:text-zinc-50 leading-none">{data?.summary.totalResidencies || 0}</p>
                        </div>
                    </div>
                </div>

                {/* Summary Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {[
                        { label: "Bookings", value: data?.summary.totalResidencies, icon: Calendar, color: "text-blue-500", bg: "bg-blue-500/10" },
                        { label: "Favorites", value: data?.summary.totalFavorites, icon: Heart, color: "text-red-500", bg: "bg-red-500/10" },
                        { label: "Ratings", value: data?.summary.totalRatings, icon: Star, color: "text-orange-500", bg: "bg-orange-500/10" },
                        { label: "Sessions", value: data?.summary.totalConversations, icon: History, color: "text-purple-500", bg: "bg-purple-500/10" },
                    ].map((stat, i) => (
                        <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-[2.5rem] shadow-sm group hover:border-blue-500/30 transition-all hover:shadow-2xl hover:shadow-blue-500/5">
                            <div className={`p-4 w-max rounded-2xl ${stat.bg} mb-6 group-hover:scale-110 transition-transform`}>
                                <stat.icon className={`w-8 h-8 ${stat.color}`} />
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">{stat.label}</div>
                            <div className="text-4xl font-black leading-none">{stat.value || 0}</div>
                        </div>
                    ))}
                </div>

                {/* Dual Column Layout: History & Profile */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">

                    {/* Recent Bookings (Main Column) */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-2xl font-black uppercase tracking-tighter flex items-center gap-3">
                                <History className="w-6 h-6 text-blue-600" />
                                Residency Ledger
                            </h2>
                            <button className="text-[9px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-600 hover:text-white px-3 py-1 rounded transition-colors">
                                View Full Chain
                            </button>
                        </div>

                        <div className="grid gap-4">
                            {data?.history.bookings.map((booking, i) => (
                                <div
                                    key={i}
                                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-[2rem] p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-xl hover:shadow-zinc-900/5 transition-all group"
                                >
                                    <div className="flex items-center gap-5">
                                        <div className="w-16 h-16 rounded-[1.25rem] bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center border border-zinc-100 dark:border-zinc-700">
                                            <MapPin className="w-6 h-6 text-zinc-300 group-hover:text-blue-500 transition-colors" />
                                        </div>
                                        <div>
                                            <div className="flex items-cen3">
                                        <div className="text-right">
                                            <p className="text-sm font-black uppercase tracking-tight leading-none mb-1">{booking.date}</p>
                                            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{booking.time}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button 
                                                onClick={() => handleDownloadReceipt(booking.id, booking.confirmationId)}
                                                disabled={downloadingId === booking.id}
                                                className="p-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-2xl hover:scale-110 transition-transform shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                                title="Download Receipt"
                                            >
                                                {downloadingId === booking.id ? (
                                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                                ) : (
                                                    <Download className="w-5 h-5" />
                                                )}
                                            </button>
                                            <button
                                                onClick={() => handleViewVenue(booking.venue)}
                                                className="p-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-2xl hover:scale-110 transition-transform shadow-lg"
                                                title="View on Map"
                                            >
                                                <ExternalLink className="w-5 h-5" />
                                            </button>
                                        </div
                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <p className="text-sm font-black uppercase tracking-tight leading-none mb-1">{booking.date}</p>
                                            <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{booking.time}</p>
                                        </div>
                                        <button 
                                            onClick={() => handleDownloadReceipt(booking.id, booking.confirmationId)}
                                            disabled={downloadingId === booking.id}
                                            className="p-4 bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 rounded-2xl hover:scale-110 transition-transform shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                                            title="Download Receipt"
                                        >
                                            {downloadingId === booking.id ? (
                                                <RefreshCw className="w-5 h-5 animate-spin" />
                                            ) : (
                                                <Download className="w-5 h-5" />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {(!data?.history.bookings || data.history.bookings.length === 0) && (
                                <div className="py-20 bg-white dark:bg-zinc-900/50 rounded-[2.5rem] border border-dashed border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center px-12">
                                    <Zap className="w-12 h-12 text-zinc-200 mb-4" />
                                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">No Signal History Recorded</p>
                                    <p className="text-xs text-zinc-500 font-bold mt-2 leading-relaxed">Book a workspace node to begin populating your personal neural ledger.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Personal Nodes & Favorites (Side Panel) */}
                    <div className="space-y-8">
                        <div>
                            <h2 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-6 flex items-center gap-2">
                                <Heart className="w-4 h-4 text-red-500" />
                                High-Signal Nodes
                            </h2>
                            <div className="space-y-3">
                                {data?.history.favorites.map((fav, i) => (
                                    <div key={i} className="bg-white dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800 p-4 rounded-2xl flex items-center gap-3 hover:border-red-500/30 transition-all">
                                        <div className="w-10 h-10 rounded-xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center text-zinc-300">
                                            <Zap className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h5 className="text-[11px] font-black uppercase tracking-tight truncate max-w-[140px]">{fav.venue.name}</h5>
                                            <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest">{fav.venue.category}</p>
                                        </div>
                                        <ArrowUpRight className="w-4 h-4 text-zinc-300 ml-auto" />
                                    </div>
                                ))}
                                {(!data?.history.favorites || data.history.favorites.length === 0) && (
                                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest py-4 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-2xl text-center">No favorites logged</p>
                                )}
                            </div>
                        </div>

                        <div className="p-8 bg-zinc-900 dark:bg-blue-600 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:scale-125 transition-transform duration-1000">
                                <RefreshCw className="w-40 h-40" />
                            </div>
                            <h3 className="text-xl font-black uppercase tracking-tighter mb-4 relative">Neural Sync</h3>
                            <p className="text-[10px] font-bold text-white/60 leading-relaxed relative uppercase tracking-widest">
                                Your profile is synchronized with the global WorkSphere node network. Every interaction creates a permanent signal in your encrypted ledger.
                            </p>
                            <div className="mt-8 flex items-center gap-4 relative">
                                <div className="text-center">
                                    <p className="text-2xl font-black leading-none">{data?.summary.totalConversations || 0}</p>
                                    <p className="text-[8px] font-black uppercase tracking-widest text-white/40">Sessions</p>
                                </div>
                                <div className="w-px h-8 bg-white/20" />
                                <div className="text-center">
                                    <p className="text-2xl font-black leading-none">{data?.summary.totalRatings || 0}</p>
                                    <p className="text-[8px] font-black uppercase tracking-widest text-white/40">Feedback</p>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
