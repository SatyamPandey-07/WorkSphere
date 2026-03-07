"use client";

import {
    PlusCircle,
    MapPin,
    Terminal,
    Activity,
    ChevronRight,
    User,
    ShieldCheck,
    Zap,
    LayoutGrid
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";

interface ChatHeaderProps {
    onOpenVenueSubmission: () => void;
    userLocation?: { lat: number; lng: number };
}

export function ChatHeader({ onOpenVenueSubmission }: ChatHeaderProps) {
    return (
        <div className="bg-white dark:bg-zinc-950 sticky top-0 z-50 p-4 border-b border-zinc-200 dark:border-zinc-800 shadow-sm transition-all">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center p-2 shadow-lg shadow-blue-500/20">
                            <Zap className="w-6 h-6 text-white" />
                        </div>
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-zinc-950 animate-pulse" />
                    </div>
                    <div>
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

                <div className="flex items-center gap-3">
                    {/* Add Venue Suggestion Button - High Contrast */}
                    <button
                        onClick={onOpenVenueSubmission}
                        className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-green-500/20 transition-all border border-green-400/30 active:scale-95 group"
                        title="Suggest a new workspace"
                    >
                        <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                        <span>ADD</span>
                    </button>

                    <div className="w-px h-8 bg-zinc-200 dark:bg-zinc-800 mx-1" />

                    {/* User Profile */}
                    <div className="flex items-center gap-2 p-1 pl-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                        <div className="hidden sm:block text-right">
                            <div className="text-[10px] font-black text-zinc-400 leading-none uppercase tracking-widest mb-0.5">MEMBER</div>
                            <div className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50 leading-none">PROFILE</div>
                        </div>
                        <UserButton afterSignOutUrl="/" />
                    </div>
                </div>
            </div>

            {/* Connection Indicator Bar */}
            <div className="mt-4 flex items-center justify-between px-1">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">NEURAL LINK ACTIVE</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.8)]" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">LATENCY: 14MS</span>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <LayoutGrid className="w-4 h-4 text-zinc-300 dark:text-zinc-700 hover:text-blue-500 cursor-pointer transition-colors" />
                    <Terminal className="w-4 h-4 text-zinc-300 dark:text-zinc-700 hover:text-blue-500 cursor-pointer transition-colors" />
                </div>
            </div>
        </div>
    );
}
