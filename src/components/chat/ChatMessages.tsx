"use client";

import {
    BookOpen,
    Brain,
    Building2,
    ChevronDown,
    ChevronUp,
    Coffee,
    Heart,
    Loader2,
    MapPin,
    Navigation,
    Send,
    Star,
    Volume2,
    Wifi,
    Zap,
    Info,
} from "lucide-react";
import { RefObject, useState, useEffect } from "react";
import { BrainTerminal } from "./BrainTerminal";
import { VenueCardSkeleton, ChatMessageSkeleton } from "@/components/ui/skeleton";
import { trackVenueInteraction } from "@/lib/analytics";

// ─── Shared types (re-declared so sub-components are self-contained) ──────────

export interface Venue {
    id: string;
    name: string;
    lat: number;
    lng: number;
    category: string;
    address?: string;
    wifi?: boolean;
    hasOutlets?: boolean;
    noiseLevel?: "quiet" | "moderate" | "loud";
    score?: number;
    description?: string;
}

export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    venues?: Venue[];
    agentSteps?: Array<{
        agent: string;
        result: Record<string, unknown>;
        timestamp: number;
    }>;
    suggestions?: string[];
}

const AGENT_ICONS: Record<string, React.ElementType> = {
    Orchestrator: Brain,
    Context: SearchIcon,
    Data: DatabaseIcon,
    Reasoning: Zap,
    Action: Navigation,
};

function SearchIcon(props: any) { return <span {...props}>🔍</span>; }
function DatabaseIcon(props: any) { return <span {...props}>💾</span>; }

const AGENT_COLORS: Record<string, string> = {
    Orchestrator: "text-purple-500",
    Context: "text-blue-500",
    Data: "text-green-500",
    Reasoning: "text-orange-500",
    Action: "text-pink-500",
};

interface VenueChatCardProps {
    venue: Venue;
    isFavorited: boolean;
    onGetDirections: (venue: Venue) => void;
    onToggleFavorite: (venue: Venue) => void;
    onRate: (venue: Venue) => void;
    onOpenDetails: (venue: Venue) => void;
    onBook: (venue: Venue) => void;
}

export function VenueChatCard({
    venue,
    isFavorited,
    onGetDirections,
    onToggleFavorite,
    onRate,
    onOpenDetails,
    onBook,
}: VenueChatCardProps) {
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [photoLoading, setPhotoLoading] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams({
            name: venue.name,
            lat: String(venue.lat),
            lng: String(venue.lng),
        });

        setPhotoLoading(true);
        fetch(`/api/venues/${encodeURIComponent(venue.id)}/photo?${params}`)
            .then(r => r.json())
            .then(data => {
                if (data.photoUrl) setPhotoUrl(data.photoUrl);
                setPhotoLoading(false);
            })
            .catch(() => setPhotoLoading(false));
    }, [venue.id, venue.name, venue.lat, venue.lng]);

    const CategoryIcon =
        venue.category === "cafe"
            ? Coffee
            : venue.category === "library"
                ? BookOpen
                : venue.category === "coworking_space"
                    ? Building2
                    : MapPin;

    const iconColor =
        venue.category === "cafe"
            ? "text-amber-600"
            : venue.category === "library"
                ? "text-blue-600"
                : venue.category === "coworking_space"
                    ? "text-purple-600"
                    : "text-zinc-600";

    const venueFallbacks: Record<string, string> = {
        cafe: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=800",
        library: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=800",
        coworking_space: "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&q=80&w=800",
        default: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=800"
    };

    const displayPhoto = photoUrl || venueFallbacks[venue.category] || venueFallbacks.default;

    return (
        <div
            onClick={() => onOpenDetails(venue)}
            className="border-2 border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-white dark:bg-zinc-900 hover:shadow-2xl hover:scale-[1.02] transition-all cursor-pointer shadow-lg my-2 active:scale-95"
        >
            {/* Venue photo */}
            {photoLoading ? (
                <div className="w-full h-44 bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
            ) : (
                <div className="relative w-full h-44 overflow-hidden group/photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={displayPhoto}
                        alt={venue.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover/photo:scale-110"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = venueFallbacks.default;
                        }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                    <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-black px-2 py-1 rounded-md bg-zinc-950 border border-zinc-700 text-white">
                        <CategoryIcon className="w-3 h-3" />
                        {venue.category?.replace("_", " ")}
                    </span>

                    {venue.score != null && (
                        <div className="absolute top-3 right-3 flex flex-col items-center justify-center h-12 w-12 rounded-full bg-blue-600 text-white border-2 border-blue-400 shadow-2xl">
                            <span className="text-[10px] font-black leading-none uppercase">Vibe</span>
                            <span className="text-sm font-black leading-none">{Math.round(venue.score * 10)}%</span>
                        </div>
                    )}
                </div>
            )}

            <div className="p-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex-shrink-0">
                        <CategoryIcon className={`w-5 h-5 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                            <h4 className="font-black text-sm text-zinc-900 dark:text-zinc-50 truncate uppercase tracking-tight">
                                {venue.name}
                            </h4>
                        </div>

                        {venue.address && (
                            <p className="text-[11px] text-zinc-500 font-medium truncate mb-2">{venue.address}</p>
                        )}

                        {/* Amenity badges */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                            {venue.wifi && (
                                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-500/10 border border-green-500/20">
                                    <Wifi className="w-3 h-3 text-green-600" />
                                    <span className="text-[10px] font-bold text-green-600 uppercase">WiFi</span>
                                </div>
                            )}
                            {venue.hasOutlets && (
                                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-yellow-500/10 border border-yellow-500/20">
                                    <Zap className="w-3 h-3 text-yellow-600" />
                                    <span className="text-[10px] font-bold text-yellow-600 uppercase">Power</span>
                                </div>
                            )}
                            {venue.noiseLevel === "quiet" && (
                                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20">
                                    <Volume2 className="w-3 h-3 text-blue-600" />
                                    <span className="text-[10px] font-bold text-blue-600 uppercase">Quiet</span>
                                </div>
                            )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        trackVenueInteraction("viewed", { id: venue.id, name: venue.name, category: venue.category });
                                        onOpenDetails(venue);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-950 hover:bg-zinc-800 transition-all font-black text-xs shadow-lg uppercase tracking-tight active:scale-[0.98]"
                                >
                                    <Info className="w-3.5 h-3.5" />
                                    Details
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onBook(venue);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-all font-black text-xs shadow-lg uppercase tracking-tight active:scale-[0.98]"
                                >
                                    <Zap className="w-3.5 h-3.5 fill-current" />
                                    Book Now
                                </button>
                            </div>

                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        trackVenueInteraction("directions", { id: venue.id, name: venue.name, category: venue.category });
                                        onGetDirections(venue);
                                    }}
                                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                                >
                                    <Navigation className="w-3 h-3" />
                                    Navigate
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        trackVenueInteraction(isFavorited ? "unfavorited" : "favorited", { id: venue.id, name: venue.name, category: venue.category });
                                        onToggleFavorite(venue);
                                    }}
                                    className={`flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg transition-all ${isFavorited
                                        ? "bg-red-500 text-white shadow-md shadow-red-500/20"
                                        : "bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    <Heart className={`w-3 h-3 ${isFavorited ? "fill-current" : ""}`} />
                                    {isFavorited ? "Saved" : "Save"}
                                </button>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onRate(venue); }}
                                    className="flex-1 flex items-center justify-center gap-1 px-2 py-2 text-[10px] uppercase font-black tracking-tighter rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
                                >
                                    <Star className="w-3 h-3" />
                                    Rate
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

interface MessageListProps {
    messages: Message[];
    isLoading: boolean;
    error: string | null;
    expandedSteps: Record<string, boolean>;
    favorites: Set<string>;
    messagesEndRef: RefObject<HTMLDivElement | null>;
    onToggleSteps: (id: string) => void;
    onGetDirections: (venue: Venue) => void;
    onToggleFavorite: (venue: Venue) => void;
    onRateVenue: (venue: Venue) => void;
    onOpenDetails: (venue: Venue) => void;
    onBook: (venue: Venue) => void;
    onSuggestionClick: (s: string) => void;
    initialSuggestions: string[];
}

export function MessageList({
    messages,
    isLoading,
    error,
    expandedSteps,
    favorites,
    messagesEndRef,
    onToggleSteps,
    onGetDirections,
    onToggleFavorite,
    onRateVenue,
    onOpenDetails,
    onBook,
    onSuggestionClick,
    initialSuggestions,
}: MessageListProps) {
    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
                <div className="text-center py-8">
                    <Brain className="w-12 h-12 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
                    <p className="text-zinc-900 dark:text-white font-bold mb-4 uppercase text-xs tracking-widest">
                        How can I help you find a workspace today?
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                        {initialSuggestions.map((s, i) => (
                            <button
                                key={i}
                                onClick={() => onSuggestionClick(s)}
                                disabled={isLoading}
                                className="text-left px-4 py-3 text-xs font-black uppercase tracking-tighter rounded-xl border-2 border-zinc-200 dark:border-zinc-800 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {messages.map((message) => (
                <div key={message.id} className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div
                            className={`max-w-[90%] rounded-2xl px-5 py-3 shadow-md border-2 ${message.role === "user"
                                ? "bg-zinc-950 border-zinc-800 text-white rounded-tr-none"
                                : "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 border-zinc-100 dark:border-zinc-700 rounded-tl-none"
                                }`}
                        >
                            <div className="text-sm font-medium leading-relaxed whitespace-pre-wrap">{message.content}</div>
                        </div>
                    </div>

                    {message.agentSteps && message.agentSteps.length > 0 && (
                        <div className="ml-2">
                            <button
                                onClick={() => onToggleSteps(message.id)}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-widest font-black text-zinc-500 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all hover:scale-105"
                            >
                                <TerminalIcon className="w-3 h-3" />
                                <span>Agent Reasoning Details</span>
                                {expandedSteps[message.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>

                            {expandedSteps[message.id] && (
                                <div className="mt-3 space-y-2 ml-4">
                                    {message.agentSteps.map((step, idx) => {
                                        const Icon = AGENT_ICONS[step.agent] || Brain;
                                        const color = AGENT_COLORS[step.agent] || "text-zinc-500";
                                        return (
                                            <div key={idx} className="bg-zinc-950 rounded-xl p-3 text-xs border border-zinc-800">
                                                <div className={`flex items-center gap-2 font-black uppercase tracking-widest text-[10px] mb-1 ${color}`}>
                                                    <Icon className="w-3 h-3" />
                                                    <span>{step.agent}</span>
                                                </div>
                                                <div className="text-zinc-400 font-mono text-[11px]">
                                                    {String(
                                                        (step.result as { reasoning?: string }).reasoning ||
                                                        JSON.stringify(step.result).slice(0, 100)
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {message.venues && message.venues.length > 0 && (
                        <div className="space-y-3 pl-2">
                            <p className="text-[10px] uppercase font-black tracking-widest text-zinc-400">
                                Recommended Venues ({message.venues.length})
                            </p>
                            {message.venues.slice(0, 5).map((venue) => (
                                <VenueChatCard
                                    key={venue.id}
                                    venue={venue}
                                    isFavorited={favorites.has(venue.id)}
                                    onGetDirections={onGetDirections}
                                    onToggleFavorite={onToggleFavorite}
                                    onRate={(v) => onRateVenue(v)}
                                    onOpenDetails={onOpenDetails}
                                    onBook={onBook}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {isLoading && (
                <div className="space-y-6 pt-4">
                    <BrainTerminal />
                </div>
            )}

            {error && (
                <div className="bg-red-950 border-2 border-red-800 rounded-xl px-4 py-3 text-xs font-bold text-red-100">
                    SYSTEM ERROR: {error}
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    );
}

function TerminalIcon(props: any) { return <span {...props}>💻</span>; }

// ─── ChatInput ────────────────────────────────────────────────────────────────

interface ChatInputProps {
    input: string;
    isLoading: boolean;
    onInputChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
}

export function ChatInput({ input, isLoading, onInputChange, onSubmit }: ChatInputProps) {
    return (
        <div className="p-4 bg-white dark:bg-zinc-950 border-t border-zinc-200 dark:border-zinc-800">
            <form
                id="ws-chat-form"
                onSubmit={onSubmit}
                className="flex gap-2 p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 focus-within:border-blue-600 transition-all shadow-inner"
            >
                <input
                    type="text"
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder="Where's the focus mode hotspot?"
                    disabled={isLoading}
                    className="flex-1 px-4 py-3 bg-transparent text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-500 focus:outline-none disabled:opacity-50 text-sm font-bold"
                />
                <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-30 transition-all active:scale-95 shadow-lg group"
                >
                    {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Send className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    )}
                </button>
            </form>
        </div>
    );
}
