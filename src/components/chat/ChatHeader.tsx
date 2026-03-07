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
}

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
}: ChatHeaderProps) {
    return (
        <div className="border-b border-zinc-200 dark:border-zinc-800 p-4">
            {/* Title row */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                        WorkSphere AI
                    </h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        Multi-Agent Workspace Finder
                    </p>
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
                        className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-green-600"
                        title="Suggest a Venue"
                    >
                        <PlusCircle className="w-5 h-5" />
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

            {/* Location indicator */}
            {location && (
                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                    <MapPin className="w-3 h-3" />
                    <span>
                        {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                    </span>
                </div>
            )}

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
