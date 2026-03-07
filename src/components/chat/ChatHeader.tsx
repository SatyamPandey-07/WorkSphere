"use client";

import {
    PlusCircle,
    MapPin,
    Terminal,
    Activity,
    ChevronDown,
    User,
    ShieldCheck,
    Zap,
    LayoutGrid,
    History,
    RotateCcw,
    Filter,
    Globe,
    Trash2,
    Search,
    ChevronRight,
    Wifi,
    Zap as Outlets,
    Volume2,
    BarChart3
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";
import { useState } from "react";
import Link from "next/link";

interface Conversation {
    id: string;
    title: string;
    updatedAt: string;
}

interface ChatHeaderProps {
    onOpenVenueSubmission: () => void;
    userLocation?: { lat: number; lng: number };
    onLocationChange: (lat: number, lng: number) => void;
    filters: { wifi?: boolean; outlets?: boolean; quiet?: boolean };
    showFilters: boolean;
    setShowFilters: (show: boolean) => void;
    onToggleFilter: (filter: string) => void;
    showHistory: boolean;
    setShowHistory: (show: boolean) => void;
    onNewChat: () => void;
    conversations: Conversation[];
    onLoadConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
}

const GLOBAL_HUBS = [
    { name: "Current Location", lat: 0, lng: 0, icon: MapPin },
    { name: "London, UK", lat: 51.5074, lng: -0.1278, icon: Globe },
    { name: "Tokyo, Japan", lat: 35.6762, lng: 139.6503, icon: Globe },
    { name: "New York, NY", lat: 40.7128, lng: -74.0060, icon: Globe },
    { name: "San Francisco", lat: 37.7749, lng: -122.4194, icon: Globe },
];

export function ChatHeader({
    onOpenVenueSubmission,
    onLocationChange,
    filters,
    showFilters,
    setShowFilters,
    onToggleFilter,
    showHistory,
    setShowHistory,
    onNewChat,
    conversations,
    onLoadConversation,
    onDeleteConversation
}: ChatHeaderProps) {
    const [isHubOpen, setIsHubOpen] = useState(false);

    return (
        <div className="bg-white dark:bg-zinc-950 sticky top-0 z-50 p-4 border-b border-zinc-200 dark:border-zinc-800 shadow-sm transition-all">
            <div className="flex items-center justify-between gap-4">
                {/* Brand & Stats */}
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center p-2 shadow-lg shadow-blue-500/20">
                            <Zap className="w-6 h-6 text-white" />
                        </div>
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-zinc-950 animate-pulse" />
                    </div>
                    <div className="hidden sm:block">
                        <div className="flex items-center gap-1.5">
                            <h1 className="text-base font-black uppercase tracking-tighter text-zinc-900 dark:text-zinc-50 leading-none">
                                WorkSphere
                            </h1>
                            <span className="flex items-center gap-1 text-[8px] font-black tracking-widest uppercase bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                                AI CORE
                            </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="flex items-center gap-1 text-[9px] font-bold text-blue-500">
                                <ShieldCheck className="w-2.5 h-2.5" />
                                SECURE
                            </span>
                            <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                            <span className="flex items-center gap-1 text-[9px] font-bold text-zinc-500">
                                <Activity className="w-2.5 h-2.5" />
                                V2.4.0
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main Actions Area */}
                <div className="flex-1 flex items-center justify-end gap-2">
                    {/* Global Hubs Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setIsHubOpen(!isHubOpen)}
                            className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-[10px] font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all active:scale-95"
                        >
                            <Globe className="w-3.5 h-3.5 text-blue-500" />
                            <span className="hidden md:inline">Global Hubs</span>
                            <ChevronDown className={`w-3 h-3 transition-transform ${isHubOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isHubOpen && (
                            <div className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-2xl z-[60] overflow-hidden">
                                {GLOBAL_HUBS.map((hub) => (
                                    <button
                                        key={hub.name}
                                        onClick={() => {
                                            onLocationChange(hub.lat, hub.lng);
                                            setIsHubOpen(false);
                                        }}
                                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-[10px] font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 last:border-0 transition-colors"
                                    >
                                        <hub.icon className="w-3.5 h-3.5 text-blue-500" />
                                        {hub.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* New Chat */}
                    <button
                        onClick={onNewChat}
                        className="p-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-blue-600 hover:text-white transition-all active:scale-95"
                        title="New Chat"
                    >
                        <RotateCcw className="w-4 h-4" />
                    </button>

                    {/* History */}
                    <button
                        onClick={() => { setShowHistory(!showHistory); setShowFilters(false); }}
                        className={`p-2 border rounded-xl transition-all active:scale-95 ${showHistory
                            ? "bg-purple-600 border-purple-400 text-white shadow-lg shadow-purple-500/20"
                            : "bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200"
                            }`}
                        title="Chat History"
                    >
                        <History className="w-4 h-4" />
                    </button>

                    {/* Filters */}
                    <button
                        onClick={() => { setShowFilters(!showFilters); setShowHistory(false); }}
                        className={`p-2 border rounded-xl transition-all active:scale-95 ${showFilters
                            ? "bg-orange-600 border-orange-400 text-white shadow-lg shadow-orange-500/20"
                            : "bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200"
                            }`}
                        title="Filters"
                    >
                        <Filter className="w-4 h-4" />
                    </button>

                    {/* Analytics Link */}
                    <Link
                        href="/analytics"
                        className="p-2 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-blue-600 hover:text-white transition-all active:scale-95 hidden lg:flex"
                        title="Intelligence Dashboard"
                    >
                        <BarChart3 className="w-4 h-4" />
                    </Link>

                    <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 mx-1 hidden sm:block" />

                    {/* Add Venue Suggestion Button - High Contrast */}
                    <button
                        onClick={onOpenVenueSubmission}
                        className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-green-500/20 transition-all border border-green-400/30 active:scale-95 group"
                        title="Suggest a new workspace"
                    >
                        <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                        <span className="hidden sm:inline">ADD</span>
                    </button>

                    <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 mx-1 hidden sm:block" />

                    {/* User Profile */}
                    <div className="flex items-center gap-2 p-1 pl-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                        <div className="hidden lg:block text-right">
                            <div className="text-[10px] font-black text-zinc-400 leading-none uppercase tracking-widest mb-0.5">MEMBER</div>
                            <div className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50 leading-none">PROFILE</div>
                        </div>
                        <UserButton afterSignOutUrl="/" />
                    </div>
                </div>
            </div>

            {/* Expansions Area */}
            <div className="relative">
                {/* Filter Overlay Area - Solid High Contrast */}
                {showFilters && (
                    <div className="mt-4 p-3 bg-zinc-50 dark:bg-zinc-900 border-2 border-orange-500/30 rounded-2xl flex flex-wrap gap-2 animate-in slide-in-from-top-2 duration-200">
                        <button
                            onClick={() => onToggleFilter('wifi')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filters.wifi ? 'bg-orange-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}
                        >
                            <Wifi className="w-3 h-3" />
                            High-Speed WiFi
                        </button>
                        <button
                            onClick={() => onToggleFilter('outlets')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filters.outlets ? 'bg-orange-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}
                        >
                            <Outlets className="w-3 h-3" />
                            Power Outlets
                        </button>
                        <button
                            onClick={() => onToggleFilter('quiet')}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filters.quiet ? 'bg-orange-600 text-white shadow-md' : 'bg-white dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'}`}
                        >
                            <Volume2 className="w-3 h-3" />
                            Low Noise
                        </button>
                    </div>
                )}

                {/* History Overlay Area - Solid High Contrast */}
                {showHistory && (
                    <div className="mt-4 bg-zinc-50 dark:bg-zinc-900 border-2 border-purple-500/30 rounded-2xl overflow-hidden animate-in slide-in-from-top-2 duration-200 max-h-64 overflow-y-auto">
                        <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-800/50">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Recent Neural Sessions</h3>
                        </div>
                        {conversations.length === 0 ? (
                            <div className="p-8 text-center">
                                <Search className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">No history found</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                                {conversations.map((conv) => (
                                    <div key={conv.id} className="group flex items-center justify-between p-3 hover:bg-white dark:hover:bg-zinc-800 transition-colors">
                                        <button
                                            onClick={() => onLoadConversation(conv.id)}
                                            className="flex-1 text-left min-w-0"
                                        >
                                            <p className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 truncate uppercase tracking-tight">
                                                {conv.title}
                                            </p>
                                            <p className="text-[9px] text-zinc-500 font-medium">
                                                {new Date(conv.updatedAt).toLocaleDateString()}
                                            </p>
                                        </button>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => onDeleteConversation(conv.id)}
                                                className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => onLoadConversation(conv.id)}
                                                className="p-1.5 rounded-md text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                            >
                                                <ChevronRight className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Connection Indicator Bar */}
            <div className="mt-4 flex items-center justify-between px-1">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">NEURAL LINK ACTIVE</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.8)]" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">LATENCY: 14MS</span>
                    </div>
                    <Link href="/analytics" className="hidden lg:flex items-center gap-1.5 hover:opacity-70 transition-opacity">
                        <Activity className="w-3 h-3 text-zinc-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">ANALYTICS</span>
                    </Link>
                </div>

                <div className="flex items-center gap-3">
                    <LayoutGrid className="w-4 h-4 text-zinc-300 dark:text-zinc-700 hover:text-blue-500 cursor-pointer transition-colors" />
                    <Terminal className="w-4 h-4 text-zinc-300 dark:text-zinc-700 hover:text-blue-500 cursor-pointer transition-colors" />
                </div>
            </div>
        </div>
    );
}
