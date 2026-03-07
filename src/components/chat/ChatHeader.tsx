"use client";

import {
    BarChart3,
    Filter,
    MapPin,
    MessageSquare,
    Plus,
    PlusCircle,
    Volume2,
    Wifi,
    Zap,
    Info,
} from "lucide-react";
import Link from "next/link";

interface Filters {
    wifi?: boolean;
    outlets?: boolean;
    quiet?: boolean;
}

interface Conversation {
    id: string;
    title: string;
    updatedAt: string;
}

interface ChatHeaderProps {
    location: { lat: number; lng: number } | undefined;
    filters: Filters;
    showFilters: boolean;
    setShowFilters: (v: boolean) => void;
    isSignedIn: boolean | undefined;
    showHistory: boolean;
    setShowHistory: (v: boolean) => void;
    conversations: Conversation[];
    currentConversationId: string | null;
    onNewChat: () => void;
    onToggleFilter: (key: keyof Filters) => void;
    onLoadConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
    onOpenVenueSubmission: () => void;
    onLocationChange: (lat: number, lng: number) => void;
}

const GLOBAL_HUBS = [
    { name: "My Location", lat: null, lng: null },
    { name: "London (Shoreditch)", lat: 51.5245, lng: -0.0841 },
    { name: "Tokyo (Shibuya)", lat: 35.6580, lng: 139.7016 },
    { name: "NYC (Brooklyn)", lat: 40.7128, lng: -73.9442 },
    { name: "Berlin (Mitte)", lat: 52.5244, lng: 13.4050 },
    { name: "Bangalore (Indiranagar)", lat: 12.9784, lng: 77.6408 },
];

export function ChatHeader({
    location,
    filters,
    showFilters,
    setShowFilters,
    isSignedIn,
    showHistory,
    setShowHistory,
    conversations,
    currentConversationId,
    onNewChat,
    onToggleFilter,
    onLoadConversation,
    onDeleteConversation,
    onOpenVenueSubmission,
    onLocationChange,
}: ChatHeaderProps) {
    return (
        <div className="glass-card sticky top-0 z-50 p-4 border-b">
            {/* Title row */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-indigo-400">
                        WorkSphere AI
                    </h2>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                        </span>
                        <p className="text-[10px] uppercase tracking-wider font-bold text-zinc-500">
                            Multi-Agent Engine v2.0
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Link
                        href="/dashboard"
                        className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Analytics Dashboard"
                    >
                        <BarChart3 className="w-5 h-5" />
                    </Link>
                    <button
                        onClick={onOpenVenueSubmission}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 hover:bg-green-500/20 text-green-600 border border-green-500/30 transition-all font-bold text-xs"
                        title="Suggest a Venue"
                    >
                        <PlusCircle className="w-4 h-4" />
                        ADD
                    </button>
                    {isSignedIn && (
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            title="Chat History"
                        >
                            <MessageSquare className="w-5 h-5" />
                        </button>
                    )}
                    <button
                        onClick={onNewChat}
                        className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="New Chat"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`p-2 rounded-lg transition-colors ${showFilters || Object.keys(filters).length > 0
                            ? "bg-blue-100 dark:bg-blue-900 text-blue-600"
                            : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            }`}
                        title="Filters"
                    >
                        <Filter className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Location indicator & Global Teleport */}
            <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <MapPin className="w-3 h-3 text-blue-500" />
                    <span className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700">
                        {location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : "Detecting..."}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-zinc-400">Hub:</span>
                    <select
                        onChange={(e) => {
                            const hub = GLOBAL_HUBS.find(h => h.name === e.target.value);
                            if (hub && hub.lat !== null && hub.lng !== null) {
                                onLocationChange(hub.lat, hub.lng);
                            } else if (hub) {
                                // Reset to true GPS - passing null/undefined can trigger effect to refetch
                                // Handle this in parent
                                onLocationChange(0, 0);
                            }
                        }}
                        className="bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/20 dark:border-zinc-800 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-tighter text-zinc-700 dark:text-zinc-300 focus:outline-none hover:bg-white/20 dark:hover:bg-zinc-800/50 transition-all"
                    >
                        {GLOBAL_HUBS.map(hub => (
                            <option key={hub.name} value={hub.name} className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50">
                                {hub.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Filter panel */}
            {showFilters && (
                <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg">
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Filter Results:
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {(
                            [
                                { key: "wifi" as keyof Filters, label: "WiFi", Icon: Wifi },
                                { key: "outlets" as keyof Filters, label: "Outlets", Icon: Zap },
                                { key: "quiet" as keyof Filters, label: "Quiet", Icon: Volume2 },
                            ] as const
                        ).map(({ key, label, Icon }) => (
                            <button
                                key={key}
                                onClick={() => onToggleFilter(key)}
                                className={`px-3 py-1.5 text-xs rounded-full flex items-center gap-1.5 transition-colors ${filters[key]
                                    ? "bg-blue-600 text-white"
                                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                                    }`}
                            >
                                <Icon className="w-3 h-3" />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Conversation history panel */}
            {showHistory && isSignedIn && (
                <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg max-h-48 overflow-y-auto">
                    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                        Recent Conversations:
                    </p>
                    {conversations.length === 0 ? (
                        <p className="text-xs text-zinc-500">No conversations yet</p>
                    ) : (
                        <div className="space-y-1">
                            {conversations.map((conv) => (
                                <div
                                    key={conv.id}
                                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${currentConversationId === conv.id
                                        ? "bg-blue-100 dark:bg-blue-900"
                                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                        }`}
                                    onClick={() => onLoadConversation(conv.id)}
                                >
                                    <span className="text-xs truncate flex-1">{conv.title}</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteConversation(conv.id);
                                        }}
                                        className="p-1 hover:text-red-500 text-zinc-400"
                                        aria-label="Delete conversation"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
