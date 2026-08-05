"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { apiFetch } from "@/lib/apiClient";
import { motion, AnimatePresence } from "framer-motion";
import { useMultiplayerSession } from "@/hooks/useRealTime";
import { VenueRatingDialog } from "./VenueRatingDialog";
import { VenueSubmissionModal } from "./VenueSubmissionModal";
import { BookingModal } from "./chat/BookingModal";
import { ChatHeader } from "./chat/ChatHeader";
import { ShortcutsModal } from "./ui/ShortcutsModal";
import { ChatInput, MessageList, Venue, Message } from "./chat/ChatMessages";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import {
  trackSearch,
  trackVenueInteraction,
  trackFilterApplied,
  trackError,
  trackAgentPerformance,
} from "@/lib/analytics";
import { calculateHaversineDistance } from "@/lib/utils";
import {
  saveFavoriteOffline,
  saveSearchOffline,
  getSearchOffline,
  getAllSearchesOffline,
  queueConversationRename,
  queueConversationDelete,
  getPendingConversationEdits,
  applyPendingConversationEdits,
  flushConversationEditQueue,
} from "@/lib/offlineStorage";
import {
  formatChatHistoryMarkdown,
  generateChatPdfReport,
} from "@/lib/chatExport";

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
    markers?: unknown[];
    routes?: unknown[];
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
  hasAncHeadsetRental?: boolean;
  singleOriginBeans?: boolean;
  specialtyEspresso?: boolean;
  oatAlmondMilk?: boolean;
  musicStyle?: "all" | "lofi" | "classical_jazz" | "no_music";
  distanceRadius?: number;
  [key: string]: unknown;
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

export function EnhancedChatbot({
  onMapUpdate,
  onOpenDetails,
  onBook,
  userLocation,
  roomId,
  onShowToast,
}: EnhancedChatbotProps) {
  const { isSignedIn, user } = useUser();

  const { socket, isHydrated } = useMultiplayerSession(roomId || null);
  const sendSocketMessage = useCallback(
    (data: string) => {
      if (socket && socket.readyState === 1) {
        try {
          socket.send(data);
        } catch (err) {
          console.error("[Socket] Failed to send message:", err);
        }
      }
    },
    [socket],
  );
  const { getToken } = useAuth();

  // Presence state
  const [cursors, setCursors] = useState<
    Record<
      string,
      {
        x: number;
        y: number;
        name: string;
        avatar: string;
      }
    >
  >({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Monotonic message ID counter — avoids React key collisions when
  // multiple messages arrive within the same millisecond (Date.now() issue).
  const msgIdCounter = useRef(0);
  const nextMsgId = () => {
    msgIdCounter.current += 1;
    return `msg-${Date.now()}-${msgIdCounter.current}`;
  };

  // Core state
  const [location, setLocation] = useState(userLocation);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>(
    {},
  );
  const [filters, setFilters] = useState<Filters>({});
  const categoryCounts = useMemo(() => {
    const counts = { cafe: 0, coworking: 0, library: 0 };
    const latestWithVenues = [...messages]
      .reverse()
      .find((m) => m.venues && m.venues.length > 0);
    const venues = latestWithVenues?.venues ?? [];
    venues.forEach((v) => {
      const cat = (v.category || "").toLowerCase();
      if (cat === "cafe") counts.cafe += 1;
      else if (cat === "library") counts.library += 1;
      else if (cat === "coworking_space" || cat === "coworking")
        counts.coworking += 1;
    });
    return counts;
  }, [messages]);
  const [showFilters, setShowFilters] = useState(false);
  const [distanceRadius, setDistanceRadius] = useState<number>(0);
  const [showHistory, setShowHistory] = useState(false);
  const [ratingVenue, setRatingVenue] = useState<Venue | null>(null);
  const [bookingVenue, setBookingVenue] = useState<Venue | null>(null);
  const [bookingMode, setBookingMode] = useState<"booking" | "history">(
    "booking",
  );
  const [showVenueSubmission, setShowVenueSubmission] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Voice & Speech Synthesis
  const {
    isSpeaking,
    autoRead,
    rate,
    toggleAutoRead,
    changeRate,
    speakMessage,
    stopSpeaking,
  } = useSpeechSynthesis();
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [isExportingChatPdf, setIsExportingChatPdf] = useState(false);

  const handleExportMarkdown = () => {
    if (messages.length === 0) return;
    const mdContent = formatChatHistoryMarkdown(messages);
    const blob = new Blob([mdContent], {
      type: "text/markdown;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `worksphere-chat-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (messages.length === 0) return;
    setIsExportingChatPdf(true);
    try {
      const pdfBytes = await generateChatPdfReport(messages);
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worksphere-chat-export-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export chat PDF:", err);
    } finally {
      setIsExportingChatPdf(false);
    }
  };

  // Conversations & favorites
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Throttled mouse tracking — only after hydration so WS traffic cannot
  // interleave with App Router streaming chunks (#1033)
  useEffect(() => {
    if (!isHydrated || !socket || !roomId) return;

    let lastSend = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      // Throttle mouse updates to 30fps (~33ms)
      if (now - lastSend > 33) {
        lastSend = now;
        sendSocketMessage(
          JSON.stringify({
            type: "cursor",
            x: e.clientX,
            y: e.clientY,
            name: user?.firstName || "Anonymous",
          }),
        );
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isHydrated, socket, roomId, user, sendSocketMessage]);

  // Handle incoming presence — defer listeners until hydration completes (#1033)
  useEffect(() => {
    if (!isHydrated || !socket) return;

    const onMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "cursor") {
          setCursors((prev) => ({
            ...prev,
            [data.name]: {
              x: data.x,
              y: data.y,
              name: data.name,
              avatar: data.avatar || "🟢",
            },
          }));
        } else if (data.type === "typing") {
          setTypingUsers((prev) => {
            if (data.isTyping) {
              return prev.includes(data.name) ? prev : [...prev, data.name];
            } else {
              return prev.filter((n) => n !== data.name);
            }
          });
        } else if (data.type === "new-message") {
          // Prevent duplicates
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
        } else if (data.type === "map-update") {
          if (onMapUpdate && data.update) {
            onMapUpdate(data.update);
          }
        } else if (data.type === "ping") {
          socket.send(
            JSON.stringify({
              type: "pong",
              timestamp: data.timestamp || Date.now(),
            }),
          );
        } else if (data.type === "peer-leave") {
          setCursors((prev) => {
            const next = { ...prev };
            if (data.name) delete next[data.name];
            return next;
          });
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };

    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [isHydrated, socket, onMapUpdate]);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastReadMsgId = useRef<string | null>(null);

  // Auto-read completion tracking
  useEffect(() => {
    if (!autoRead) return;
    const lastMsg = messages[messages.length - 1];
    if (
      lastMsg &&
      lastMsg.role === "assistant" &&
      !lastMsg.isStreaming &&
      lastMsg.content &&
      lastReadMsgId.current !== lastMsg.id
    ) {
      speakMessage(lastMsg.content);
      lastReadMsgId.current = lastMsg.id;
    }
  }, [messages, autoRead, speakMessage]);

  // Geolocation fallback
  const getPreciseLocation = useCallback(() => {
    if ("geolocation" in navigator) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (pos.coords.accuracy !== undefined && pos.coords.accuracy > 50) {
              console.warn(
                `GPS accuracy too low in chatbot (${pos.coords.accuracy}m). Falling back.`,
              );
              setLocation({ lat: 37.7749, lng: -122.4194 });
              return;
            }
            const newLoc = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            };
            setLocation(newLoc);
            onMapUpdate?.({
              type: "SET_MAP_VIEW",
              data: { center: newLoc, zoom: 14, animate: true },
            });
          },
          () => setLocation({ lat: 37.7749, lng: -122.4194 }),
        );
      } catch (err) {
        console.warn("Geolocation sync error in chatbot:", err);
        setLocation({ lat: 37.7749, lng: -122.4194 });
      }
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
        if (
          prev &&
          prev.lat === userLocation.lat &&
          prev.lng === userLocation.lng
        ) {
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

      const update = {
        type: "SET_MAP_VIEW",
        data: { center: newLoc, zoom: 14, animate: true },
      };
      onMapUpdate?.(update);

      if (socket && roomId) {
        sendSocketMessage(JSON.stringify({ type: "map-update", update }));
      }
    }
  };

  // Conversations
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) {
        const data = await res.json();
        const rawConversations: Conversation[] = data.conversations || [];
        const pendingEdits = await getPendingConversationEdits();
        const merged = applyPendingConversationEdits(
          rawConversations,
          pendingEdits,
        );
        setConversations(merged);
      }
    } catch (e) {
      console.error("Failed to load conversations:", e);
    }
  }, []);

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
          data.messages.map(
            (m: {
              id: string;
              role: "user" | "assistant";
              content: string;
            }) => ({
              id: m.id,
              role: m.role,
              content: m.content,
            }),
          ),
        );
        setShowHistory(false);
      }
    } catch (e) {
      console.error("Failed to load conversation:", e);
    }
  };

  const deleteConversation = async (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (currentConversationId === id) {
      setCurrentConversationId(null);
      setMessages([]);
    }

    if (!navigator.onLine) {
      await queueConversationDelete(id);
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed with status ${res.status}`);
    } catch (e) {
      console.error("Failed to delete conversation, queuing for retry:", e);
      await queueConversationDelete(id);
    }
  };

  const renameConversation = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
    );

    if (!navigator.onLine) {
      await queueConversationRename(id, trimmed);
      return;
    }

    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error(`Rename failed with status ${res.status}`);
    } catch (e) {
      console.error("Failed to rename conversation, queuing for retry:", e);
      await queueConversationRename(id, trimmed);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      flushConversationEditQueue().then(() => {
        if (isSignedIn) loadConversations();
      });
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [isSignedIn, loadConversations]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isTyping =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.getAttribute("contenteditable") === "true");

      if (e.key === "?" && !isTyping) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const chatInput = document.querySelector(
          "#ws-chat-form input",
        ) as HTMLInputElement;
        chatInput?.focus();
      }

      if (e.key === "Escape") {
        setRatingVenue(null);
        setBookingVenue(null);
        setBookingMode("booking");
        setShowVenueSubmission(false);
        setShowShortcutsModal(false);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  const startNewChat = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setShowHistory(false);
  };

  // Favorites
  const loadFavorites = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites");
      if (res.ok) {
        const data = await res.json();
        setFavorites(
          new Set<string>(
            data.favorites?.map(
              (f: { venuePlaceId?: string; venueId: string }) =>
                f.venuePlaceId || f.venueId,
            ) || [],
          ),
        );
      }
    } catch (e) {
      console.error("Failed to load favorites:", e);
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      loadConversations();
      loadFavorites();
    }
  }, [isSignedIn, loadConversations, loadFavorites]);

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
        trackVenueInteraction("unfavorited", {
          id: venue.id,
          name: venue.name,
          category: venue.category,
        });
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
        trackVenueInteraction("favorited", {
          id: venue.id,
          name: venue.name,
          category: venue.category,
        });
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
      trackError(
        e instanceof Error ? e : new Error(String(e)),
        "favorite_toggle",
      );
    }
  };

  // Rating
  const handleRatingSubmit = async (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    hasErgonomic?: boolean;
    outletDensity?: string;
    wifiSpeed?: number;
    hasPhoneBooths?: boolean;
    hasNoMusic?: boolean;
    hasQuietZone?: boolean;
    hasAncHeadsetRental?: boolean;
    singleOriginBeans?: boolean;
    specialtyEspresso?: boolean;
    oatAlmondMilk?: boolean;
    pourOverAvailable?: boolean;
    musicStyle?: string;
    petsAllowedIndoors?: boolean;
    patioOnly?: boolean;
    waterBowlsProvided?: boolean;
    dogFriendly?: boolean;
    catsAllowed?: boolean;
  }) => {
    const targetVenue = ratingVenue;
    if (!targetVenue || !isSignedIn) return;
    const previousMessages = [...messages];
    try {
      // Optimistic UI update before server response finishes
      setMessages((prev) =>
        prev.map((msg) => {
          if (!msg.venues) return msg;
          return {
            ...msg,
            venues: msg.venues.map((v) =>
              v.id === targetVenue.id
                ? {
                    ...v,
                    score: rating.wifiQuality,
                    rating: rating.wifiQuality,
                    wifiQuality: rating.wifiQuality,
                    hasOutlets: rating.hasOutlets,
                    noiseLevel: rating.noiseLevel,
                  }
                : v,
            ),
          };
        }),
      );

      const token = await getToken();
      await fetch(`/api/venues/${targetVenue.id}/rate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...rating,
          venue: {
            name: targetVenue.name,
            lat: targetVenue.lat,
            lng: targetVenue.lng,
            category: targetVenue.category,
            address: targetVenue.address,
          },
        }),
      });
      trackVenueInteraction("rated", {
        id: targetVenue.id,
        name: targetVenue.name,
        category: targetVenue.category,
      });
      setRatingVenue(null);
    } catch (e) {
      setMessages(previousMessages);
      console.error("Failed to submit rating:", e);
      trackError(
        e instanceof Error ? e : new Error(String(e)),
        "rating_submit",
      );
    }
  };
  const handleSubmitRating = handleRatingSubmit;

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
        next[key] = true;
      }
      trackFilterApplied(next);
      return next;
    });
  };

  const handleSetFilter = (key: string, value: unknown) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (
        value === undefined ||
        value === null ||
        value === "none" ||
        value === "all"
      ) {
        delete next[key];
      } else {
        next[key] = value;
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
      setTimeout(() => {
        const form = document.getElementById(
          "ws-chat-form",
        ) as HTMLFormElement | null;
        form?.requestSubmit();
      }, 50);
    },
    [isLoading],
  );
  const handleRefreshVenues = async () => {
    if (!location) return;

    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng),
      radius: "5000",
    });

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== false) {
        params.set(key, String(value));
      }
    });

    const response = await apiFetch(`/api/venues?${params.toString()}`);

    if (!response.ok) {
      throw new Error("Failed to refresh venues");
    }

    const data = await response.json();

    const refreshedVenues: Venue[] = (data.venues ?? []).map((venue: any) => ({
      ...venue,
      lat: Number(venue.latitude),
      lng: Number(venue.longitude),
    }));

    setMessages((prev) => {
      const latestVenueMessageIndex = prev.findLastIndex(
        (message) => message.venues && message.venues.length > 0,
      );

      if (latestVenueMessageIndex === -1) return prev;

      return prev.map((message, index) =>
        index === latestVenueMessageIndex
          ? { ...message, venues: refreshedVenues }
          : message,
      );
    });
  };
  // Main submit
  const handleInputChange = (val: string) => {
    const safeVal = typeof val === "string" ? val : "";
    setInput(safeVal);
    if (socket && roomId) {
      sendSocketMessage(
        JSON.stringify({
          type: "typing",
          isTyping: safeVal.length > 0,
          name: user?.firstName || "Anonymous",
        }),
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (socket && roomId) {
      sendSocketMessage(
        JSON.stringify({
          type: "typing",
          isTyping: false,
          name: user?.firstName || "Anonymous",
        }),
      );
    }

    const userMessage = input.trim();
    setInput("");
    setError(null);
    setIsLoading(true);
    stopSpeaking(); // Interrupt ongoing speech when user submits a new prompt

    let convId = currentConversationId;
    if (!convId && isSignedIn) {
      convId = await createConversation();
    }

    const newUserMessage: Message = {
      id: nextMsgId(),
      role: "user",
      content: userMessage,
      name: user?.firstName || "Anonymous",
    };

    setMessages((prev) => {
      if (prev.some((m) => m.id === newUserMessage.id)) return prev;
      return [...prev, newUserMessage];
    });

    setMessages((prev) => [...prev, newUserMessage]);

    if (socket && roomId) {
      sendSocketMessage(
        JSON.stringify({ type: "new-message", message: newUserMessage }),
      );
    }

    if (location) {
      trackSearch(userMessage, location, filters as Record<string, unknown>);
    }

    try {
      const startTime = Date.now();
      const response = await apiFetch("/api/chat", {
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
        let errorMessage = "Failed to send message";

        try {
          const data = await response.json();
          if (data?.error) errorMessage = data.error;
        } catch {
          // Ignore JSON parsing errors
        }

        if (response.status === 429) {
          errorMessage =
            "High traffic detected. Please wait a few seconds and try searching again.";
        }

        throw new Error(errorMessage);
      }

      const assistantMessageId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          isStreaming: true,
        },
      ]);

      setIsLoading(false);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
                const metadata = JSON.parse(metaStr);

                if (metadata.highTraffic) {
                  onShowToast?.(
                    "High traffic detected. Please wait a few seconds and try searching again.",
                  );
                }

                if (metadata.agentSteps) {
                  (metadata.agentSteps as AgentStep[]).forEach((step) => {
                    trackAgentPerformance(
                      step.agent,
                      Date.now() - startTime,
                      true,
                    );
                  });
                }

                let finalVenues = metadata.venues ?? [];
                if (distanceRadius > 0 && location) {
                  finalVenues = finalVenues.filter((v: Venue) => {
                    const d = calculateHaversineDistance(
                      location.lat,
                      location.lng,
                      v.lat,
                      v.lng,
                    );
                    return d <= distanceRadius;
                  });
                }
                metadata.venues = finalVenues;

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
                      : m,
                  ),
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
                    })),
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
                    sendSocketMessage(
                      JSON.stringify({ type: "map-update", update }),
                    );
                  }
                }
              } catch (e) {
                console.error("Failed to parse metadata", e);
              }
            } else if (chunk.startsWith("TEXT:")) {
              const text = chunk.slice(5);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, content: m.content + text }
                    : m,
                ),
              );
            }
          }
        }
      }

      setMessages((prev) => {
        const finalMsg = prev.find((m) => m.id === assistantMessageId);
        if (finalMsg && socket && roomId) {
          sendSocketMessage(
            JSON.stringify({ type: "new-message", message: finalMsg }),
          );
        }
        return prev.map((m) =>
          m.id === assistantMessageId ? { ...m, isStreaming: false } : m,
        );
      });
    } catch (err) {
      console.error("Chat error:", err);
      const errMsg =
        err instanceof Error
          ? err.message
          : "Failed to send message. Please try again.";
      const isOfflineError =
        err instanceof TypeError ||
        errMsg.toLowerCase().includes("failed to fetch") ||
        errMsg.toLowerCase().includes("network");
      if (isOfflineError) {
        try {
          const cached = await getSearchOffline(userMessage);
          if (cached) {
            let venues: Venue[] = cached.results.map((v) => ({
              id: v.id,
              name: v.name,
              lat: v.latitude,
              lng: v.longitude,
              category: v.category ?? "coworking_space",
              address: v.address,
            }));

            if (distanceRadius > 0 && location) {
              venues = venues.filter((v) => {
                const d = calculateHaversineDistance(
                  location.lat,
                  location.lng,
                  v.lat,
                  v.lng,
                );
                return d <= distanceRadius;
              });
            }

            setMessages((prev) => [
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
                markers: venues.map((v) => ({
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
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now().toString(),
                role: "assistant",
                content:
                  "📡 You're offline and we don't have a cached result for that search. Try one of your recent searches:",
                suggestions: recentSearches.map((s) => s.query),
              },
            ]);
            setIsLoading(false);
            return;
          }
        } catch (offlineError) {
          console.error(offlineError);
        }
      }
      setError(errMsg);
      if (errMsg.includes("High traffic detected")) {
        onShowToast?.(errMsg);
      }
      trackError(
        err instanceof Error ? err : new Error(String(err)),
        "chat_submit",
      );
    } finally {
      setIsLoading(false);
      setMessages((prev) =>
        prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
      );
    }
  };

  // Render
  return (
    <div className="flex h-full flex-col min-h-0 bg-white dark:bg-zinc-950 relative overflow-hidden">
      {/* Remote Cursors */}
      <AnimatePresence>
        {Object.values(cursors).map((cursor) => (
          <motion.div
            key={cursor.name}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, x: cursor.x, y: cursor.y }}
            exit={{ opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 25,
              mass: 0.5,
            }}
            className="pointer-events-none fixed z-[9999] flex flex-col items-start"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              className="text-orange-500 drop-shadow-md"
            >
              <path
                d="M5.65376 21.2087L2.61053 2.76633C2.39958 1.48834 3.75545 0.559955 4.88795 1.2059L22.2891 11.1444C23.4795 11.8242 23.3664 13.5786 22.0934 14.108L14.7706 17.1517L12.5976 24.3235C12.1932 25.658 10.366 25.8643 9.68063 24.6548L5.65376 21.2087Z"
                fill="currentColor"
              />
            </svg>
            <div className="bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full ml-4 shadow-md whitespace-nowrap flex items-center gap-1">
              <span>{cursor.avatar}</span>
              <span>{cursor.name}</span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      <ChatHeader
        categoryCounts={categoryCounts}
        onOpenVenueSubmission={() => setShowVenueSubmission(true)}
        userLocation={location}
        onLocationChange={handleLocationChange}
        filters={{ ...filters, distanceRadius }}
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
        onRenameConversation={renameConversation}
        roomId={roomId || currentConversationId}
        onShareSession={() => {
          let sessionToShare = roomId || currentConversationId;
          if (!sessionToShare) {
            sessionToShare =
              Date.now().toString(36) +
              Math.random().toString(36).substring(2, 7);
            const url = new URL(window.location.href);
            url.searchParams.set("session", sessionToShare);
            window.location.href = url.toString();
            return;
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
        onRefreshVenues={handleRefreshVenues}
      />

      {/* Voice Control Settings Toggle Area */}
      <div className="flex flex-col border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
        <div className="flex justify-between items-center px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowVoiceSettings(!showVoiceSettings)}
              className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center gap-1 transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20a16 16 0 0 1-16-16 M12 20a16 16 0 0 0 16-16 M12 20v-16 M2 12h20 M4 8h16 M4 16h16" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Voice Settings
            </button>
            {isSpeaking && (
              <button
                onClick={stopSpeaking}
                className="text-xs px-2 py-1 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                Stop Audio
              </button>
            )}
          </div>

          <div
            className="flex items-center gap-2"
            aria-label="Export Conversation"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 hidden sm:inline">
              Export Chat:
            </span>
            <button
              onClick={handleExportMarkdown}
              disabled={messages.length === 0}
              className="text-[11px] font-bold px-2.5 py-1 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40 transition-colors"
              title="Export conversation history to Markdown (.md)"
            >
              .MD
            </button>
            <button
              onClick={handleExportPdf}
              disabled={messages.length === 0 || isExportingChatPdf}
              className="text-[11px] font-bold px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              title="Export conversation history to PDF (.pdf)"
            >
              {isExportingChatPdf ? "Exporting…" : ".PDF"}
            </button>
          </div>

          {showVoiceSettings && (
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1 cursor-pointer text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={autoRead}
                  onChange={toggleAutoRead}
                  className="rounded text-blue-500 focus:ring-blue-500 bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                />
                Auto-read
              </label>
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <span>Speed:</span>
                <input
                  type="range"
                  min="0.75"
                  max="2.0"
                  step="0.25"
                  value={rate}
                  onChange={(e) => changeRate(parseFloat(e.target.value))}
                  className="w-16 h-1 bg-zinc-300 rounded-lg appearance-none cursor-pointer dark:bg-zinc-700 accent-blue-500"
                />
                <span className="w-6">{rate}x</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={handleInputChange}
        onSubmit={handleSubmit}
        distanceRadius={distanceRadius}
        onDistanceChange={setDistanceRadius}
      />

      {typingUsers.length > 0 && (
        <div className="absolute bottom-[80px] left-4 text-[10px] text-zinc-500 font-medium animate-pulse">
          {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"}{" "}
          typing...
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
              suggestions: [
                "Search for workspaces nearby",
                "Show my favorites",
              ],
            },
          ]);
        }}
      />

      <ShortcutsModal
        isOpen={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </div>
  );
}
