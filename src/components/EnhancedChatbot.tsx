"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
  MapPin,
  Wifi,
  Coffee,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronUp,
  Zap,
  Volume2,
  Filter,
  MessageSquare,
  Plus,
  Trash2,
  Brain,
  Search,
  Database,
  Calculator,
  Play,
  Heart,
  Star,
  Navigation,
} from "lucide-react";
import { useUser } from "@clerk/nextjs";
import { VenueRatingDialog } from "./VenueRatingDialog";
import { 
  trackSearch, 
  trackVenueInteraction, 
  trackFilterApplied, 
  trackError,
  recordSearchPattern,
  recordAgentMetric
} from "@/lib/analytics";

interface MapUpdate {
  type: string;
  markers?: Array<{
    id: string;
    lat: number;
    lng: number;
    name: string;
    category: string;
    address?: string;
    wifi?: boolean;
    score?: number;
  }>;
  route?: {
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
    venueName?: string;
  };
}

interface EnhancedChatbotProps {
  onMapUpdate?: (update: MapUpdate) => void;
  userLocation?: { lat: number; lng: number };
}

interface Venue {
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

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  venues?: Venue[];
  agentSteps?: AgentStep[];
  suggestions?: string[];
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

interface Filters {
  wifi?: boolean;
  outlets?: boolean;
  quiet?: boolean;
}

const AGENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Orchestrator: Brain,
  Context: Search,
  Data: Database,
  Reasoning: Calculator,
  Action: Play,
};

const AGENT_COLORS: Record<string, string> = {
  Orchestrator: "text-purple-500",
  Context: "text-blue-500",
  Data: "text-green-500",
  Reasoning: "text-orange-500",
  Action: "text-pink-500",
};

export function EnhancedChatbot({ onMapUpdate, userLocation }: EnhancedChatbotProps) {
  const { isSignedIn } = useUser();
  const [location, setLocation] = useState(userLocation);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [ratingVenue, setRatingVenue] = useState<Venue | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Get location
  useEffect(() => {
    if (!location && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocation({ lat: 37.7749, lng: -122.4194 })
      );
    }
  }, [location]);

  // Load conversations on mount (if signed in)
  useEffect(() => {
    if (isSignedIn) {
      loadConversations();
      loadFavorites();
    }
  }, [isSignedIn]);

  const loadFavorites = async () => {
    try {
      const res = await fetch("/api/favorites");
      if (res.ok) {
        const data = await res.json();
        const favoriteIds = new Set<string>(
          data.favorites?.map((f: { venueId: string }) => f.venueId) || []
        );
        setFavorites(favoriteIds);
      }
    } catch (e) {
      console.error("Failed to load favorites:", e);
    }
  };

  const loadConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (e) {
      console.error("Failed to load conversations:", e);
    }
  };

  const createConversation = async () => {
    if (!isSignedIn) return null;
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Search" }),
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentConversationId(data.id);
        await loadConversations();
        return data.id;
      }
    } catch (e) {
      console.error("Failed to create conversation:", e);
    }
    return null;
  };

  const loadConversation = async (id: string) => {
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentConversationId(id);
        setMessages(
          data.messages.map((m: { id: string; role: "user" | "assistant"; content: string }) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          }))
        );
        setShowHistory(false);
      }
    } catch (e) {
      console.error("Failed to load conversation:", e);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      await loadConversations();
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error("Failed to delete conversation:", e);
    }
  };

  const startNewChat = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setShowHistory(false);
  };

  const toggleSteps = (messageId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setError(null);
    setIsLoading(true);

    // Create conversation if needed
    let convId = currentConversationId;
    if (!convId && isSignedIn) {
      convId = await createConversation();
    }

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
    };
    setMessages((prev) => [...prev, newUserMessage]);

    // Track search analytics
    if (location) {
      trackSearch(userMessage, location, filters as Record<string, unknown>);
      recordSearchPattern(userMessage);
    }

    try {
      const startTime = Date.now();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, newUserMessage],
          location,
          conversationId: convId,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      const data = await response.json();

      // Track agent performance from response
      if (data.agentSteps) {
        data.agentSteps.forEach((step: AgentStep) => {
          recordAgentMetric(step.agent, Date.now() - startTime, true);
        });
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.content || "I couldn't generate a response.",
        venues: data.venues,
        agentSteps: data.agentSteps,
        suggestions: data.suggestions,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Update map
      if (data.venues && data.venues.length > 0 && onMapUpdate) {
        onMapUpdate({
          type: "markers",
          markers: data.venues.map((v: Venue) => ({
            id: v.id,
            lat: v.lat,
            lng: v.lng,
            name: v.name,
            category: v.category,
            address: v.address,
            wifi: v.wifi,
            score: v.score,
          })),
        });
      }
    } catch (err) {
      console.error("Error:", err);
      setError("Failed to send message. Please try again.");
      trackError(err instanceof Error ? err : new Error(String(err)), 'chat_submit');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    if (isLoading) return;
    setInput(suggestion);
    setTimeout(() => document.querySelector("form")?.requestSubmit(), 50);
  };

  const toggleFilter = (key: keyof Filters) => {
    setFilters((prev) => {
      const newFilters = { ...prev };
      if (newFilters[key]) {
        delete newFilters[key];
      } else {
        (newFilters as Record<string, boolean>)[key] = true;
      }
      // Track filter changes
      trackFilterApplied(newFilters);
      return newFilters;
    });
  };

  // Save venue to favorites
  const handleSaveFavorite = async (venue: Venue) => {
    if (!isSignedIn) {
      setError("Please sign in to save favorites");
      return;
    }
    try {
      const isFavorited = favorites.has(venue.id);
      if (isFavorited) {
        await fetch(`/api/favorites?venueId=${venue.id}`, { method: "DELETE" });
        setFavorites((prev) => {
          const newSet = new Set(prev);
          newSet.delete(venue.id);
          return newSet;
        });
        trackVenueInteraction('unfavorited', { id: venue.id, name: venue.name, category: venue.category });
      } else {
        await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueId: venue.id,
            placeId: venue.id,
            name: venue.name,
            latitude: venue.lat,
            longitude: venue.lng,
            category: venue.category,
            address: venue.address,
          }),
        });
        setFavorites((prev) => new Set(prev).add(venue.id));
        trackVenueInteraction('favorited', { id: venue.id, name: venue.name, category: venue.category });
      }
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
      trackError(e instanceof Error ? e : new Error(String(e)), 'favorite_toggle');
    }
  };

  // Submit venue rating
  const handleSubmitRating = async (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    comment?: string;
  }) => {
    if (!ratingVenue || !isSignedIn) return;
    try {
      await fetch(`/api/venues/${ratingVenue.id}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rating,
          venue: {
            name: ratingVenue.name,
            lat: ratingVenue.lat,
            lng: ratingVenue.lng,
            category: ratingVenue.category,
            address: ratingVenue.address,
          },
        }),
      });
      trackVenueInteraction('rated', { id: ratingVenue.id, name: ratingVenue.name, category: ratingVenue.category });
      setRatingVenue(null);
    } catch (e) {
      console.error("Failed to submit rating:", e);
      trackError(e instanceof Error ? e : new Error(String(e)), 'rating_submit');
    }
  };

  // Get directions (update map with route)
  const handleGetDirections = (venue: Venue) => {
    if (!location || !onMapUpdate) return;
    onMapUpdate({
      type: "route",
      route: {
        from: location,
        to: { lat: venue.lat, lng: venue.lng },
        venueName: venue.name,
      },
    });
  };

  const suggestions = [
    "Find a quiet cafe with good WiFi near me",
    "Show me coworking spaces within 2 miles",
    "I need a place for a video call",
    "Find libraries with outlets",
  ];

  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              WorkHub Assistant
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Multi-Agent AI Workspace Finder
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              onClick={startNewChat}
              className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="New Chat"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${
                showFilters || Object.keys(filters).length > 0
                  ? "bg-blue-100 dark:bg-blue-900 text-blue-600"
                  : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title="Filters"
            >
              <Filter className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Location */}
        {location && (
          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
            <MapPin className="w-3 h-3" />
            <span>{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</span>
          </div>
        )}

        {/* Filters Panel */}
        {showFilters && (
          <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg">
            <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
              Filter Results:
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => toggleFilter("wifi")}
                className={`px-3 py-1.5 text-xs rounded-full flex items-center gap-1.5 transition-colors ${
                  filters.wifi
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Wifi className="w-3 h-3" /> WiFi
              </button>
              <button
                onClick={() => toggleFilter("outlets")}
                className={`px-3 py-1.5 text-xs rounded-full flex items-center gap-1.5 transition-colors ${
                  filters.outlets
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Zap className="w-3 h-3" /> Outlets
              </button>
              <button
                onClick={() => toggleFilter("quiet")}
                className={`px-3 py-1.5 text-xs rounded-full flex items-center gap-1.5 transition-colors ${
                  filters.quiet
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Volume2 className="w-3 h-3" /> Quiet
              </button>
            </div>
          </div>
        )}

        {/* Conversation History */}
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
                    className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                      currentConversationId === conv.id
                        ? "bg-blue-100 dark:bg-blue-900"
                        : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                    onClick={() => loadConversation(conv.id)}
                  >
                    <span className="text-xs truncate flex-1">{conv.title}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteConversation(conv.id);
                      }}
                      className="p-1 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Brain className="w-12 h-12 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              How can I help you find a workspace today?
            </p>
            <div className="grid grid-cols-1 gap-2">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(s)}
                  disabled={isLoading}
                  className="text-left px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="space-y-2">
            {/* Message Bubble */}
            <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-2 ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
                }`}
              >
                <div className="text-sm whitespace-pre-wrap">{message.content}</div>
              </div>
            </div>

            {/* Agent Steps (Transparency) */}
            {message.agentSteps && message.agentSteps.length > 0 && (
              <div className="ml-2">
                <button
                  onClick={() => toggleSteps(message.id)}
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
                            {String((step.result as { reasoning?: string; summary?: string }).reasoning || 
                              (step.result as { summary?: string }).summary || 
                              JSON.stringify(step.result).slice(0, 150))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Venue Cards */}
            {message.venues && message.venues.length > 0 && (
              <div className="space-y-2 pl-2">
                <p className="text-xs text-zinc-500 font-medium">
                  Found {message.venues.length} places:
                </p>
                {message.venues.slice(0, 5).map((venue) => (
                  <div
                    key={venue.id}
                    className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white dark:bg-zinc-900 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start gap-2">
                      <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        {venue.category === "cafe" && <Coffee className="w-4 h-4 text-amber-600" />}
                        {venue.category === "library" && <BookOpen className="w-4 h-4 text-blue-600" />}
                        {venue.category === "coworking_space" && <Building2 className="w-4 h-4 text-purple-600" />}
                        {!["cafe", "library", "coworking_space"].includes(venue.category) && (
                          <MapPin className="w-4 h-4 text-zinc-600" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-sm text-zinc-900 dark:text-zinc-50 truncate">
                            {venue.name}
                          </h4>
                          {venue.score && (
                            <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
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
                        {/* Action Buttons */}
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                          <button
                            onClick={() => handleGetDirections(venue)}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                            title="Get Directions"
                          >
                            <Navigation className="w-3 h-3" />
                            <span>Directions</span>
                          </button>
                          <button
                            onClick={() => handleSaveFavorite(venue)}
                            className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                              favorites.has(venue.id)
                                ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                                : "bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                            }`}
                            title={favorites.has(venue.id) ? "Remove from Favorites" : "Add to Favorites"}
                          >
                            <Heart className={`w-3 h-3 ${favorites.has(venue.id) ? "fill-current" : ""}`} />
                            <span>{favorites.has(venue.id) ? "Saved" : "Save"}</span>
                          </button>
                          <button
                            onClick={() => setRatingVenue(venue)}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors"
                            title="Rate Venue"
                          >
                            <Star className="w-3 h-3" />
                            <span>Rate</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Suggestions */}
            {message.suggestions && message.suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-2">
                {message.suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(s)}
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

        {isLoading && (
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
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-4 py-2 text-sm text-red-600 dark:text-red-400">
            Error: {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about workspaces..."
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </form>
      </div>

      {/* Rating Dialog */}
      {ratingVenue && (
        <VenueRatingDialog
          isOpen={!!ratingVenue}
          onClose={() => setRatingVenue(null)}
          venueName={ratingVenue.name}
          venueId={ratingVenue.id}
          onSubmit={handleSubmitRating}
        />
      )}
    </div>
  );
}
