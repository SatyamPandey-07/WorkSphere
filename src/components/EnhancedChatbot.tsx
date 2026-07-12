"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "framer-motion";
import { useMultiplayerSession } from "@/hooks/useRealTime";
import { VenueRatingDialog } from "./VenueRatingDialog";
import { VenueSubmissionModal } from "./VenueSubmissionModal";
import { BookingModal } from "./chat/BookingModal";
import { ChatHeader } from "./chat/ChatHeader";
import { ChatInput, MessageList, Venue, Message } from "./chat/ChatMessages";
import {
  trackSearch,
  trackVenueInteraction,
  trackFilterApplied,
  trackError,
  trackAgentPerformance,
} from "@/lib/analytics";
import {
  saveFavoriteOffline,
  saveSearchOffline,
  getSearchOffline,
  getAllSearchesOffline,
} from "@/lib/offlineStorage";

// Types

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
  data?: {
    center?: { lat: number; lng: number };
    zoom?: number;
    animate?: boolean;
    markers?: any[];
    routes?: any[];
  };
}

interface EnhancedChatbotProps {
  onMapUpdate?: (update: MapUpdate) => void;
  onOpenDetails: (venue: Venue) => void;
  onBook: (venue: Venue) => void;
  userLocation?: { lat: number; lng: number };
  roomId?: string | null;
  onShowToast?: (msg: string) => void;
}

interface Filters {
  wifi?: boolean;
  outlets?: boolean;
  quiet?: boolean;
  ergonomic?: boolean;
  outletDensity?: "every_table" | "some_tables" | "wall_seats" | "none";
  wifiSpeedBand?: "basic" | "fast" | "ultra" | "all";
  hasPhoneBooths?: boolean;
  hasNoMusic?: boolean;
  hasQuietZone?: boolean;
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

// Static suggestion chips

const INITIAL_SUGGESTIONS = [
  "Find a quiet cafe with good WiFi near me",
  "Show me coworking spaces within 2 miles",
  "I need a place for a video call",
  "Find libraries with outlets",
];

// Component

export function EnhancedChatbot({ onMapUpdate, onOpenDetails, onBook, userLocation, roomId, onShowToast }: EnhancedChatbotProps) {
  const { isSignedIn, user } = useUser();
  const { getToken } = useAuth();

  const { socket } = useMultiplayerSession(roomId || null);

  // Presence state
  const [cursors, setCursors] = useState<Record<string, { x: number; y: number; name: string }>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Track local cursor
  useEffect(() => {
    if (!socket || !roomId) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Throttle mouse moves to avoid flooding
      if (Math.random() > 0.8) {
        socket.send(JSON.stringify({
          type: "cursor",
          x: e.clientX,
          y: e.clientY,
          name: user?.firstName || "Anonymous"
        }));
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [socket, roomId, user]);

  // Handle incoming presence
  useEffect(() => {
    if (!socket) return;

    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "cursor") {
          setCursors(prev => ({
            ...prev,
            [data.name]: { x: data.x, y: data.y, name: data.name }
          }));
        } else if (data.type === "typing") {
          setTypingUsers(prev => {
            if (data.isTyping) {
              return prev.includes(data.name) ? prev : [...prev, data.name];
            } else {
              return prev.filter(n => n !== data.name);
            }
          });
        } else if (data.type === "new-message") {
          // Prevent duplicates
          setMessages(prev => {
            if (prev.some(m => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
        } else if (data.type === "map-update") {
          if (onMapUpdate && data.update) {
            onMapUpdate(data.update);
          }
        }
      } catch { }
    };

    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket, onMapUpdate]);

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
  const [bookingVenue, setBookingVenue] = useState<Venue | null>(null);
  const [bookingMode, setBookingMode] = useState<"booking" | "history">("booking");
  const [showVenueSubmission, setShowVenueSubmission] = useState(false);

  // Conversations & favorites
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Geolocation fallback
  const getPreciseLocation = useCallback(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const newLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setLocation(newLoc);
          onMapUpdate?.({
            type: "SET_MAP_VIEW",
            data: { center: newLoc, zoom: 14, animate: true }
          });
        },
        () => setLocation({ lat: 37.7749, lng: -122.4194 })
      );
    }
  }, [onMapUpdate]);

  useEffect(() => {
    if (!location) {
      getPreciseLocation();
    }
  }, [location, getPreciseLocation]);

  useEffect(() => {
    if (userLocation) {
      setLocation((prev) => {
        if (prev && prev.lat === userLocation.lat && prev.lng === userLocation.lng) {
          return prev;
        }
        return userLocation;
      });
    }
  }, [userLocation]);

  const handleLocationChange = (lat: number, lng: number) => {
    if (lat === 0 && lng === 0) {
      getPreciseLocation();
    } else {
      const newLoc = { lat, lng };
      setLocation(newLoc);

      const update = { type: "SET_MAP_VIEW", data: { center: newLoc, zoom: 14, animate: true } };
      onMapUpdate?.(update);

      if (socket && roomId) {
        socket.send(JSON.stringify({ type: "map-update", update }));
      }
    }
  };

  // Load conversations & favorites on sign-in
  useEffect(() => {
    if (isSignedIn) {
      loadConversations();
      loadFavorites();
    }
  }, [isSignedIn]);

  // Conversations
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

  // Favorites
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

  // Rating
  const handleSubmitRating = async (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    avgDecibels?: number;
    peakDecibels?: number;
    comment?: string;
    hasErgonomic: boolean;
    outletDensity: "every_table" | "some_tables" | "wall_seats" | "none";
    wifiSpeed?: number;
    speedtestPhoto?: string;
    hasPhoneBooths?: boolean;
    hasNoMusic?: boolean;
    hasQuietZone?: boolean;
  }) => {
    if (!ratingVenue || !isSignedIn) return;
    try {
      const token = await getToken();
      await fetch(`/api/venues/${ratingVenue.id}/rate`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
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

  // Directions
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

  // Filters
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

  const handleSetFilter = (key: string, value: any) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === null || value === "none" || value === "all") {
        delete next[key as keyof Filters];
      } else {
        (next as any)[key] = value;
      }
      trackFilterApplied(next);
      return next;
    });
  };

  // Agent step expand/collapse
  const toggleSteps = (messageId: string) => {
    setExpandedSteps((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  // Suggestion click
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

  // Main submit
  const handleInputChange = (val: string) => {
    setInput(val);
    if (socket && roomId) {
      socket.send(JSON.stringify({
        type: "typing",
        isTyping: val.length > 0,
        name: user?.firstName || "Anonymous"
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (socket && roomId) {
      socket.send(JSON.stringify({
        type: "typing",
        isTyping: false,
        name: user?.firstName || "Anonymous"
      }));
    }

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
      name: user?.firstName || "Anonymous"
    };
    setMessages((prev) => [...prev, newUserMessage]);

    if (socket && roomId) {
      socket.send(JSON.stringify({ type: "new-message", message: newUserMessage }));
    }

    if (location) {
      trackSearch(userMessage, location, filters as Record<string, unknown>);
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

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("High traffic detected. Please wait a few seconds and try searching again.");
        }
        throw new Error("Failed to send message");
      }

      const assistantMessageId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
        },
      ]);
      
      setIsLoading(false); // Stream starts, disable loading spinner

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let metadata: any = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/(?=METADATA:|TEXT:)/);
          buffer = chunks.pop() || "";
          
          for (const chunk of chunks) {
            if (chunk.startsWith("METADATA:")) {
              const metaStr = chunk.slice(9).trim();
              try {
                metadata = JSON.parse(metaStr);
                
                if (metadata.highTraffic) {
                  onShowToast?.("High traffic detected. Please wait a few seconds and try searching again.");
                }

                if (metadata.agentSteps) {
                  (metadata.agentSteps as AgentStep[]).forEach((step) => {
                    trackAgentPerformance(step.agent, Date.now() - startTime, true);
                  });
                }
                
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessageId
                      ? {
                          ...m,
                          venues: metadata.venues,
                          agentSteps: metadata.agentSteps,
                          suggestions: metadata.suggestions,
                          cached: metadata.cached,
                          complexity: metadata.complexity,
                        }
                      : m
                  )
                );

              try {
              await saveSearchOffline(
               userMessage,
               (metadata.venues ?? []).map((v: Venue) => ({
               id: v.id,
               name: v.name,
               latitude: v.lat,
               longitude: v.lng,
               category: v.category,
               address: v.address,
               }))
               );
               } catch (err) {
                console.warn("Failed to cache search:", err);
              }
                
                if (metadata.venues?.length > 0 && onMapUpdate) {
                  const update = {
                    type: "markers",
                    markers: metadata.venues.map((v: Venue) => ({
                      id: v.id,
                      lat: v.lat,
                      lng: v.lng,
                      name: v.name,
                      category: v.category,
                      address: v.address,
                      wifi: v.wifi,
                      score: v.score,
                    })),
                  };
                  onMapUpdate(update);
                  if (socket && roomId) {
                    socket.send(JSON.stringify({ type: "map-update", update }));
                  }
                }
              } catch(e) {
                console.error("Failed to parse metadata", e);
              }
            } else if (chunk.startsWith("TEXT:")) {
              const text = chunk.slice(5);
              setMessages(prev => prev.map(m => m.id === assistantMessageId ? { ...m, content: m.content + text } : m));
            }
          }
        }
        
        // Process remaining buffer
        if (buffer) {
          if (buffer.startsWith("METADATA:")) {
            const metaStr = buffer.slice(9).trim();
            try { 
              metadata = JSON.parse(metaStr); 
              setMessages((prev) =>
                prev.map((m) => m.id === assistantMessageId ? {
                  ...m,
                  venues: metadata.venues,
                  agentSteps: metadata.agentSteps,
                  suggestions: metadata.suggestions,
                  cached: metadata.cached,
                  complexity: metadata.complexity,
                } : m)
              );

              try {
                await saveSearchOffline(
                  userMessage,
                  (metadata.venues ?? []).map((v: Venue) => ({
                    id: v.id,
                    name: v.name,
                    latitude: v.lat,
                    longitude: v.lng,
                    category: v.category,
                    address: v.address,
                  }))
                );
              } catch (err) {
                console.warn("Failed to cache search:", err);
              }
            } catch {}
          } else if (buffer.startsWith("TEXT:")) {
            const text = buffer.slice(5);
            setMessages(prev => prev.map(m => m.id === assistantMessageId ? { ...m, content: m.content + text } : m));
          }
        }
      }
      
      // Final message sync for socket
      setMessages((prev) => {
        const finalMsg = prev.find(m => m.id === assistantMessageId);
        if (finalMsg && socket && roomId) {
          socket.send(JSON.stringify({ type: "new-message", message: finalMsg }));
        }
        return prev;
      });
    } catch (err) {
      console.error("Chat error:", err);
      const errMsg = err instanceof Error ? err.message : "Failed to send message. Please try again.";
try {
        const cached = await getSearchOffline(userMessage);

        if (cached) {
          const venues: Venue[] = cached.results.map(v => ({
            id: v.id,
            name: v.name,
            lat: v.latitude,
            lng: v.longitude,
            category: v.category ?? "coworking_space",
            address: v.address,
          }));

          setMessages(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant",
              content:
                "📦 You're offline. Showing your cached search results.",
              venues,
              cached: true,
            },
          ]);

          if (onMapUpdate) {
            onMapUpdate({
              type: "markers",
              markers: venues.map(v => ({
                id: v.id,
                lat: v.lat,
                lng: v.lng,
                name: v.name,
                category: v.category,
                address: v.address,
              })),
            });
          }

          setIsLoading(false);
          return;
        }

        const recentSearches = await getAllSearchesOffline();
        if (recentSearches.length > 0) {
          setMessages(prev => [
            ...prev,
            {
              id: Date.now().toString(),
              role: "assistant",
              content:
                "📡 You're offline and we don't have a cached result for that search. Try one of your recent searches:",
              suggestions: recentSearches.map(s => s.query),
            },
          ]);
          setIsLoading(false);
          return;
        }
      } catch (offlineError) {
        console.error(offlineError);
      }
      setError(errMsg);
      if (errMsg.includes("High traffic detected")) {
        onShowToast?.(errMsg);
      }
      trackError(err instanceof Error ? err : new Error(String(err)), "chat_submit");
    } finally {
      setIsLoading(false);
    }
  };

  // Render
  return (
    <div className="flex h-full flex-col bg-white dark:bg-zinc-950 relative overflow-hidden">
      {/* Remote Cursors */}
      <AnimatePresence>
        {Object.values(cursors).map(cursor => (
          <motion.div
            key={cursor.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, x: cursor.x, y: cursor.y }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25, mass: 0.5 }}
            className="pointer-events-none fixed z-[9999] flex flex-col items-start"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-orange-500 drop-shadow-md">
              <path d="M5.65376 21.2087L2.61053 2.76633C2.39958 1.48834 3.75545 0.559955 4.88795 1.2059L22.2891 11.1444C23.4795 11.8242 23.3664 13.5786 22.0934 14.108L14.7706 17.1517L12.5976 24.3235C12.1932 25.658 10.366 25.8643 9.68063 24.6548L5.65376 21.2087Z" fill="currentColor" />
            </svg>
            <div className="bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-4 shadow-md whitespace-nowrap">
              {cursor.name}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <ChatHeader
        onOpenVenueSubmission={() => setShowVenueSubmission(true)}
        userLocation={location}
        onLocationChange={handleLocationChange}
        filters={filters}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        onToggleFilter={(key) => toggleFilter(key as keyof Filters)}
        onSetFilter={handleSetFilter}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        onNewChat={startNewChat}
        conversations={conversations}
        onLoadConversation={loadConversation}
        onDeleteConversation={deleteConversation}
        roomId={roomId || currentConversationId}
        onShareSession={() => {
          let sessionToShare = roomId || currentConversationId;
          if (!sessionToShare) {
            sessionToShare = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
            const url = new URL(window.location.href);
            url.searchParams.set("session", sessionToShare);
            // Instead of just copying, we need to be in that session too, so let's navigate to it
            window.location.href = url.toString();
            return; // the reload will put them in the room
          }
          const url = new URL(window.location.href);
          url.searchParams.set("session", sessionToShare);
          navigator.clipboard.writeText(url.toString());
          alert("Session link copied to clipboard!");
        }}
        onShowBookings={() => {
          setBookingMode("history");
          setBookingVenue(null);
        }}
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
        onBook={(v) => {
          setBookingVenue(v);
          setBookingMode("booking");
          onBook(v);
        }}
        onSuggestionClick={handleSuggestionClick}
        initialSuggestions={INITIAL_SUGGESTIONS}
      />

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
      />

      {typingUsers.length > 0 && (
        <div className="absolute bottom-[80px] left-4 text-[10px] text-zinc-500 font-medium animate-pulse">
          {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
        </div>
      )}

      {/* Dialogs */}
      <VenueRatingDialog
        isOpen={!!ratingVenue}
        venueId={ratingVenue?.id || ""}
        venueName={ratingVenue?.name || ""}
        onClose={() => setRatingVenue(null)}
        onSubmit={handleSubmitRating}
      />

      <BookingModal
        isOpen={!!bookingVenue || bookingMode === "history"}
        venue={bookingVenue}
        mode={bookingMode}
        onClose={() => {
          setBookingVenue(null);
          setBookingMode("booking");
        }}
      />

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