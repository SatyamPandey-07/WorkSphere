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
} from "lucide-react";
import { RefObject, useState } from "react";
import { VenueCardSkeleton, ChatMessageSkeleton } from "@/components/ui/skeleton";

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
    noiseLevel?: string;
    score?: number;
}

interface AgentStep {
    agent: string;
    result: Record<string, unknown>;
    timestamp: number;
}

export interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
    venues?: Venue[];
    agentSteps?: AgentStep[];
    suggestions?: string[];
}

// ─── Agent icon/colour maps ───────────────────────────────────────────────────

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    Orchestrator: Brain,
    Context: MapPin,
    Data: Wifi,
    Reasoning: Zap,
    Action: Navigation,
};

const AGENT_COLORS: Record<string, string> = {
    Orchestrator: "text-purple-500",
    Context: "text-blue-500",
    Data: "text-green-500",
    Reasoning: "text-orange-500",
    Action: "text-pink-500",
};

// ─── VenueChatCard ────────────────────────────────────────────────────────────

interface VenueChatCardProps {
    venue: Venue;
    isFavorited: boolean;
    onGetDirections: (venue: Venue) => void;
    onToggleFavorite: (venue: Venue) => void;
    onRate: (venue: Venue) => void;
}

export function VenueChatCard({
    venue,
    isFavorited,
    onGetDirections,
    onToggleFavorite,
    onRate,
}: VenueChatCardProps) {
    // ── Venue photo — proxied through our API (API key stays server-side) ──────
    const [photoState, setPhotoState] = useState<"loading" | "loaded" | "error">("loading");
    const photoSrc = `/api/venues/${encodeURIComponent(venue.id)}/photo?${new URLSearchParams({
        name: venue.name,
        lat: String(venue.lat),
        lng: String(venue.lng),
    })}`;

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

    return (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 hover:shadow-md transition-shadow">
            {/* Venue photo — image is proxied server-side, key never hits the browser */}
            <div className={`relative w-full h-28 overflow-hidden ${photoState === "error" ? "hidden" : ""}`}>
                {photoState === "loading" && (
                    <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={photoSrc}
                    alt={venue.name}
                    className={`w-full h-full object-cover transition-opacity duration-500 ${photoState === "loaded" ? "opacity-100" : "opacity-0"}`}
                    onLoad={() => setPhotoState("loaded")}
                    onError={() => setPhotoState("error")}
                />
                {photoState === "loaded" && (
                    <span className="absolute bottom-1.5 left-2 text-xs px-1.5 py-0.5 rounded bg-black/60 text-white capitalize">
                        {venue.category?.replace("_", " ")}
                    </span>
                )}
            </div>

            <div className="p-3">
                <div className="flex items-start gap-2">
                    <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex-shrink-0">
                        <CategoryIcon className={`w-4 h-4 ${iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        {/* Name + score */}
                        <div className="flex items-center gap-2">
                            <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-50 truncate">
                                {venue.name}
                            </h4>
                            {venue.score != null && (
                                <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded flex-shrink-0">
                                    {venue.score}/10
                                </span>
                            )}
                        </div>

                        <p className="text-xs text-zinc-500 capitalize">
                            {venue.category?.replace("_", " ")}
                        </p>

                        {venue.address && (
                            <p className="text-xs text-zinc-400 truncate mt-0.5">{venue.address}</p>
                        )}

                        {/* Amenity badges */}
                        <div className="flex items-center gap-2 mt-1">
                            {venue.wifi && (
                                <div className="flex items-center gap-0.5">
                                    <Wifi className="w-3 h-3 text-green-600" />
                                    <span className="text-xs text-green-600">WiFi</span>
                                </div>
                            )}
                            {venue.hasOutlets && (
                                <div className="flex items-center gap-0.5">
                                    <Zap className="w-3 h-3 text-yellow-600" />
                                    <span className="text-xs text-yellow-600">Outlets</span>
                                </div>
                            )}
                            {venue.noiseLevel === "quiet" && (
                                <div className="flex items-center gap-0.5">
                                    <Volume2 className="w-3 h-3 text-blue-600" />
                                    <span className="text-xs text-blue-600">Quiet</span>
                                </div>
                            )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={() => onGetDirections(venue)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                            >
                                <Navigation className="w-3 h-3" />
                                Directions
                            </button>
                            <button
                                onClick={() => onToggleFavorite(venue)}
                                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${isFavorited
                                    ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                                    : "bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                    }`}
                            >
                                <Heart className={`w-3 h-3 ${isFavorited ? "fill-current" : ""}`} />
                                {isFavorited ? "Saved" : "Save"}
                            </button>
                            <button
                                onClick={() => onRate(venue)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                            >
                                <Star className="w-3 h-3" />
                                Rate
                            </button>
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
    onToggleSteps: (messageId: string) => void;
    onGetDirections: (venue: Venue) => void;
    onToggleFavorite: (venue: Venue) => void;
    onRateVenue: (venue: Venue) => void;
    onSuggestionClick: (suggestion: string) => void;
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
    onSuggestionClick,
    initialSuggestions,
}: MessageListProps) {
    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Empty state */}
            {messages.length === 0 && (
                <div className="text-center py-8">
                    <Brain className="w-12 h-12 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
                    <p className="text-zinc-600 dark:text-zinc-400 mb-4">
                        How can I help you find a workspace today?
                    </p>
                    <div className="grid grid-cols-1 gap-2">
                        {initialSuggestions.map((s, i) => (
                            <button
                                key={i}
                                onClick={() => onSuggestionClick(s)}
                                disabled={isLoading}
                                className="text-left px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-50"
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Message thread */}
            {messages.map((message) => (
                <div key={message.id} className="space-y-2">
                    {/* Bubble */}
                    <div
                        className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        <div
                            className={`max-w-[85%] rounded-lg px-4 py-2 ${message.role === "user"
                                ? "bg-blue-600 text-white"
                                : "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                                }`}
                        >
                            <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                        </div>
                    </div>

                    {/* Agent pipeline steps */}
                    {message.agentSteps && message.agentSteps.length > 0 && (
                        <div className="ml-2">
                            <button
                                onClick={() => onToggleSteps(message.id)}
                                className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                            >
                                <Brain className="w-3 h-3" />
                                <span>Agent Pipeline ({message.agentSteps.length} steps)</span>
                                {expandedSteps[message.id] ? (
                                    <ChevronUp className="w-3 h-3" />
                                ) : (
                                    <ChevronDown className="w-3 h-3" />
                                )}
                            </button>

                            {expandedSteps[message.id] && (
                                <div className="mt-2 space-y-2 border-l-2 border-zinc-200 dark:border-zinc-800 pl-3">
                                    {message.agentSteps.map((step, idx) => {
                                        const Icon = AGENT_ICONS[step.agent] || Brain;
                                        const color = AGENT_COLORS[step.agent] || "text-zinc-500";
                                        return (
                                            <div
                                                key={idx}
                                                className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2 text-xs"
                                            >
                                                <div className={`flex items-center gap-1.5 font-medium ${color}`}>
                                                    <Icon className="w-3 h-3" />
                                                    <span>{step.agent} Agent</span>
                                                </div>
                                                <div className="mt-1 text-zinc-600 dark:text-zinc-400">
                                                    {String(
                                                        (step.result as { reasoning?: string; summary?: string })
                                                            .reasoning ||
                                                        (step.result as { summary?: string }).summary ||
                                                        JSON.stringify(step.result).slice(0, 150)
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Venue cards */}
                    {message.venues && message.venues.length > 0 && (
                        <div className="space-y-2 pl-2">
                            <p className="text-xs text-zinc-500 font-medium">
                                Found {message.venues.length} places:
                            </p>
                            {message.venues.slice(0, 5).map((venue) => (
                                <VenueChatCard
                                    key={venue.id}
                                    venue={venue}
                                    isFavorited={favorites.has(venue.id)}
                                    onGetDirections={onGetDirections}
                                    onToggleFavorite={onToggleFavorite}
                                    onRate={onRateVenue}
                                />
                            ))}
                        </div>
                    )}

                    {/* Follow-up suggestions */}
                    {message.suggestions && message.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-2 pl-2">
                            {message.suggestions.map((s, i) => (
                                <button
                                    key={i}
                                    onClick={() => onSuggestionClick(s)}
                                    disabled={isLoading}
                                    className="px-3 py-1 text-xs rounded-full border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-50"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ))}

            {/* Loading skeletons */}
            {isLoading && (
                <div className="space-y-3">
                    <div className="flex justify-start">
                        <div className="bg-zinc-100 dark:bg-zinc-900 rounded-lg px-4 py-3">
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                    Running AI agents...
                                </span>
                            </div>
                        </div>
                    </div>
                    <ChatMessageSkeleton />
                    <div className="pl-2">
                        <VenueCardSkeleton />
                        <VenueCardSkeleton />
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm text-red-600 dark:text-red-400">
                    Error: {error}
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    );
}

// ─── ChatInput ────────────────────────────────────────────────────────────────

interface ChatInputProps {
    input: string;
    isLoading: boolean;
    onInputChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
}

export function ChatInput({ input, isLoading, onInputChange, onSubmit }: ChatInputProps) {
    return (
        <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
            <form id="ws-chat-form" onSubmit={onSubmit} className="flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    placeholder="Ask about workspaces..."
                    disabled={isLoading}
                    className="flex-1 px-4 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
                />
                <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Send className="w-5 h-5" />
                    )}
                </button>
            </form>
        </div>
    );
}
