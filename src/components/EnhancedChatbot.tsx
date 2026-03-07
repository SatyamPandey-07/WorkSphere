"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { VenueRatingDialog } from "./VenueRatingDialog";
import { VenueSubmissionModal } from "./VenueSubmissionModal";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInput, MessageList, Venue, Message } from "./chat/ChatMessages";
import {
  trackSearch,
  trackVenueInteraction,
  trackFilterApplied,
  trackError,
  recordSearchPattern,
  recordAgentMetric,
} from "@/lib/analytics";
import { saveFavoriteOffline } from "@/lib/offlineStorage";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  onOpenDetails: (venue: Venue) => void;
  userLocation?: { lat: number; lng: number };
}

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

interface AgentStep {
  agent: string;
  result: Record<string, unknown>;
  timestamp: number;
}

// ─── Static suggestion chips ──────────────────────────────────────────────────

const INITIAL_SUGGESTIONS = [
  "Find a quiet cafe with good WiFi near me",
  "Show me coworking spaces within 2 miles",
  "I need a place for a video call",
  "Find libraries with outlets",
];

// ─── Component ────────────────────────────────────────────────────────────────

export function EnhancedChatbot({ onMapUpdate, onOpenDetails, userLocation }: EnhancedChatbotProps) {
  const { isSignedIn } = useUser();

  // Core state
  const [location, setLocation] = useState(userLocation);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [filters, setFilters] = useState<Filters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [ratingVenue, setRatingVenue] = useState<Venue | null>(null);
  const [showVenueSubmission, setShowVenueSubmission] = useState(false);

  // Conversations & favorites
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // ── Auto-scroll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Geolocation fallback ─────────────────────────────────────────────────────
  const getPreciseLocation = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setLocation({ lat: 37.7749, lng: -122.4194 })
      );
    }
  }, []);

  useEffect(() => {
    if (!location) {
      getPreciseLocation();
    }
  }, [location, getPreciseLocation]);

  const handleLocationChange = (lat: number, lng: number) => {
    if (lat === 0 && lng === 0) {
      // Reset to precise location
      getPreciseLocation();
    } else {
      setLocation({ lat, lng });
    }
  };

  // ── Load conversations & favorites on sign-in ─────────────────────────────
  useEffect(() => {
    if (isSignedIn) {
      loadConversations();
      loadFavorites();
    }
  }, [isSignedIn]);

  // ── Conversations ────────────────────────────────────────────────────────────
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

  const createConversation = async (): Promise<string | null> => {
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

  // ── Favorites ────────────────────────────────────────────────────────────────
  const loadFavorites = async () => {
    try {
      const res = await fetch("/api/favorites");
      if (res.ok) {
        const data = await res.json();
        setFavorites(
          new Set<string>(data.favorites?.map((f: { venueId: string }) => f.venueId) || [])
        );
      }
    } catch (e) {
      console.error("Failed to load favorites:", e);
    }
  };

  const handleToggleFavorite = async (venue: Venue) => {
    if (!isSignedIn) {
      setError("Please sign in to save favorites");
      return;
    }
    try {
      const isFavorited = favorites.has(venue.id);
      if (isFavorited) {
        await fetch(`/api/favorites?venueId=${venue.id}`, { method: "DELETE" });
        setFavorites((prev) => {
          const next = new Set(prev);
          next.delete(venue.id);
          return next;
        });
        trackVenueInteraction("unfavorited", { id: venue.id, name: venue.name, category: venue.category });
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
        trackVenueInteraction("favorited", { id: venue.id, name: venue.name, category: venue.category });
        try {
          await saveFavoriteOffline({
            id: venue.id,
            name: venue.name,
            latitude: venue.lat,
            longitude: venue.lng,
            category: venue.category,
            address: venue.address,
          });
        } catch (offlineErr) {
          console.warn("Failed to save favorite offline:", offlineErr);
        }
      }
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
      trackError(e instanceof Error ? e : new Error(String(e)), "favorite_toggle");
    }
  };

  // ── Rating ───────────────────────────────────────────────────────────────────
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
      trackVenueInteraction("rated", {
        id: ratingVenue.id,
        name: ratingVenue.name,
        category: ratingVenue.category,
      });
      setRatingVenue(null);
    } catch (e) {
      console.error("Failed to submit rating:", e);
      trackError(e instanceof Error ? e : new Error(String(e)), "rating_submit");
    }
  };

  // ── Directions ───────────────────────────────────────────────────────────────
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

  // ── Filters ───────────────────────────────────────────────────────────────────
  const toggleFilter = (key: keyof Filters) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        (next as Record<string, boolean>)[key] = true;
      }
      trackFilterApplied(next);
      return next;
    });
  };

  // ── Agent step expand/collapse ────────────────────────────────────────────────
  const toggleSteps = (messageId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  // ── Suggestion click ─────────────────────────────────────────────────────────
  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      if (isLoading) return;
      setInput(suggestion);
      // Submit on next tick after state settles
      setTimeout(() => {
        const form = document.getElementById("ws-chat-form") as HTMLFormElement | null;
        form?.requestSubmit();
      }, 50);
    },
    [isLoading]
  );

  // ── Main submit ───────────────────────────────────────────────────────────────
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

      if (data.agentSteps) {
        (data.agentSteps as AgentStep[]).forEach((step) => {
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

      if (data.venues?.length > 0 && onMapUpdate) {
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
      console.error("Chat error:", err);
      setError("Failed to send message. Please try again.");
      trackError(err instanceof Error ? err : new Error(String(err)), "chat_submit");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-950">
      <ChatHeader
        onOpenVenueSubmission={() => setShowVenueSubmission(true)}
        userLocation={userLocation}
      />

      <MessageList
        messages={messages}
        isLoading={isLoading}
        error={error}
        expandedSteps={expandedSteps}
        favorites={favorites}
        messagesEndRef={messagesEndRef}
        onToggleSteps={toggleSteps}
        onGetDirections={handleGetDirections}
        onToggleFavorite={handleToggleFavorite}
        onRateVenue={(venue) => setRatingVenue(venue)}
        onOpenDetails={onOpenDetails}
        onSuggestionClick={handleSuggestionClick}
        initialSuggestions={INITIAL_SUGGESTIONS}
      />

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSubmit={handleSubmit}
      />

      {/* Dialogs */}
      {ratingVenue && (
        <VenueRatingDialog
          isOpen={!!ratingVenue}
          onClose={() => setRatingVenue(null)}
          venueName={ratingVenue.name}
          venueId={ratingVenue.id}
          onSubmit={handleSubmitRating}
        />
      )}

      <VenueSubmissionModal
        isOpen={showVenueSubmission}
        onClose={() => setShowVenueSubmission(false)}
        userLocation={location}
        onSubmitSuccess={() => {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant",
              content:
                "🎉 Thank you for suggesting a venue! It has been added to our database and will appear in future searches.",
              suggestions: ["Search for workspaces nearby", "Show my favorites"],
            },
          ]);
        }}
      />
    </div>
  );
}
