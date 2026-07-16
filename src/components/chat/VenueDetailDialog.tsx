"use client";

import {
  X,
  MapPin,
  Wifi,
  Zap,
  Volume2,
  Navigation,
  Heart,
  Coffee,
  BookOpen,
  Building2,
  Star,
  Info,
  AlertTriangle,
  Camera,
  Eye,
  Globe2,
  Sun,
  VolumeX,
  Calendar,
  Printer,
  Car,
  CircleDollarSign,
  Bike,
  Shield,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";

import { Venue } from "./ChatMessages";
import { RatingDistribution } from "./RatingDistribution";

interface VenueDetailDialogProps {
  venue: Venue | null;
  isOpen: boolean;
  isFavorited: boolean;
  onClose: () => void;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  onRate?: (venue: Venue) => void;
}

interface VoteMetricState {
  confidenceScore: number;
  upvotes: number;
  downvotes: number;
  hidden: boolean;
  userVote: boolean | null;
}

export function VenueDetailDialog({
  venue,
  isOpen,
  isFavorited,
  onClose,
  onGetDirections,
  onToggleFavorite,
  onRate,
}: VenueDetailDialogProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(true);
  const [liveScore, setLiveScore] = useState<number | null>(null);
  const { t } = useTranslation();
  const [translatingReviewId, setTranslatingReviewId] = useState<string | null>(
    null,
  );
  const [translatedReviews, setTranslatedReviews] = useState<
    Record<string, string>
  >({});
  const [activeDistribution, setActiveDistribution] = useState<
    "wifi" | "outlets" | "noise" | null
  >(null);

  // =========================================================================
  // COMMUNITY AMENITY VALIDATION STATE DICTIONARY
  // =========================================================================
  const [voteMetrics, setVoteMetrics] = useState<
    Record<string, VoteMetricState>
  >({
    wifi: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    outlets: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    silentRoom: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    studyTable: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    scanner: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    freeStreetParking: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    paidGarage: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    bicycleRack: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    secureMotorcycleParking: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
    petsAllowedIndoors: {
      confidenceScore: 100,
      upvotes: 0,
      downvotes: 0,
      hidden: false,
      userVote: null,
    },
  });

  // Tab and dynamic content states
  const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "menu">(
    "overview",
  );
  const [reviews, setReviews] = useState<any[]>([]);
  const [menuPhotos, setMenuPhotos] = useState<string[]>([]);
  const [uploadingMenu, setUploadingMenu] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [wifiPredictions, setWifiPredictions] = useState<any[]>([]);

  const _submitAmenityVote = async (
    amenityKey:
      | "wifi"
      | "outlets"
      | "silentRoom"
      | "studyTable"
      | "scanner"
      | "freeStreetParking"
      | "paidGarage"
      | "bicycleRack"
      | "secureMotorcycleParking"
      | "petsAllowedIndoors",
    isUpvote: boolean,
  ) => {
    if (!venue) return;
    try {
      const response = await fetch("/api/venues/amenity-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: venue.id,
          amenity: amenityKey,
          isUpvote,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setVoteMetrics((prev) => ({
          ...prev,
          [amenityKey]: {
            confidenceScore: data.confidenceScore,
            upvotes: data.upvotes,
            downvotes: data.downvotes,
            hidden: data.hidden,
            userVote: isUpvote,
          },
        }));
      }
    } catch (error) {
      console.error("Failed to post metadata validation toggle:", error);
    }
  };

  const handleTranslate = async (review: any) => {
    if (!review.comment || translatedReviews[review.id]) return;

    setTranslatingReviewId(review.id);
    try {
      const langCode = navigator.language || "en";
      let targetLanguageName = "English";
      try {
        targetLanguageName =
          new Intl.DisplayNames(["en"], { type: "language" }).of(langCode) ||
          langCode;
      } catch {
        targetLanguageName = langCode;
      }

      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: review.comment,
          targetLanguage: targetLanguageName,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        setTranslatedReviews((prev) => ({
          ...prev,
          [review.id]: data.translatedText,
        }));
      }
    } catch (error) {
      console.error("Translation failed:", error);
    } finally {
      setTranslatingReviewId(null);
    }
  };

  // Effect 1: Venue badalne par state reset karna aur photo fetch karna
  useEffect(() => {
    if (!venue || !isOpen) return;

    const venueId = venue.id;
    async function loadVoteMetrics() {
      try {
        const response = await fetch(`/api/venues/${venueId}/amenity-votes`);
        if (response.ok) {
          const data = await response.json();
          setVoteMetrics(() => ({
            wifi: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            outlets: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            silentRoom: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            studyTable: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            scanner: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            freeStreetParking: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            paidGarage: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            bicycleRack: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            secureMotorcycleParking: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            petsAllowedIndoors: {
              confidenceScore: 100,
              upvotes: 0,
              downvotes: 0,
              hidden: false,
              userVote: null,
            },
            ...data.metrics,
          }));
        }
      } catch (error) {
        console.error("Failed to load amenity vote metrics:", error);
      }
    }
    loadVoteMetrics();
  }, [venue, isOpen]);

  useEffect(() => {
    if (!venue) return;
    setLiveScore(venue.score ?? null);
    setPhotoLoading(true);
    setActiveTab("overview");
    setActiveDistribution(null);
    const params = new URLSearchParams({
      name: venue.name,
      lat: String(venue.lat),
      lng: String(venue.lng),
    });

    fetch(`/api/venues/${encodeURIComponent(venue.id)}/photo?${params}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load venue photo");
        }

        setPhotoUrl(response.url);
      })
      .catch(() => {
        setPhotoUrl(null);
      })
      .finally(() => {
        setPhotoLoading(false);
      });
  }, [venue]);

  // Effect 2: Handle real-time SSE updates
  useEffect(() => {
    if (!isOpen || !venue) return;

    let eventSource: EventSource | null = null;

    const connect = () => {
      if (eventSource) {
        eventSource.close();
      }
      console.log(`[SSE] Connecting to live stream for venue: ${venue.id}`);
      eventSource = new EventSource(
        `/api/venues/${encodeURIComponent(venue.id)}/live-stream`,
      );

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && typeof data.score === "number") {
            setLiveScore(data.score);
          }
        } catch (err) {
          console.error("Error parsing SSE data:", err);
        }
      };

      eventSource.onerror = (error) => {
        console.error("SSE Connection Error:", error);
      };
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log(
          `[SSE] Tab visible, resetting connection for venue: ${venue.id}`,
        );
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();

    return () => {
      console.log(`[SSE] Terminating active stream for venue: ${venue.id}`);
      if (eventSource) {
        eventSource.close();
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [venue, isOpen]);

  // Fetch reviews on dialog open / venue change to have stats ready
  useEffect(() => {
    if (!venue || !isOpen) return;
    fetch(`/api/venues/${encodeURIComponent(venue.id)}/reviews`)
      .then((r) => r.json())
      .then((data) => {
        if (data.reviews) setReviews(data.reviews);
      })
      .catch((err) => console.error(err));
  }, [venue, isOpen]);

  // Effect 3: Fetch predictions and menu photos based on active tab
  useEffect(() => {
    if (!venue || !isOpen) return;

    if (activeTab === "overview") {
      fetch(`/api/venues/${encodeURIComponent(venue.id)}/wifi-prediction`)
        .then((r) => r.json())
        .then((data) => {
          if (data.predictions) setWifiPredictions(data.predictions);
        })
        .catch((err) => console.error(err));
    } else if (activeTab === "reviews") {
      fetch(`/api/venues/${encodeURIComponent(venue.id)}/reviews`)
        .then((r) => r.json())
        .then((data) => {
          if (data.reviews) setReviews(data.reviews);
        })
        .catch((err) => console.error(err));
    } else if (activeTab === "menu") {
      setMenuPhotos([]);
      fetch(`/api/venues/${encodeURIComponent(venue.id)}/menu`)
        .then((r) => r.json())
        .then((data) => {
          if (data.menuPhotos) setMenuPhotos(data.menuPhotos);
        })
        .catch((err) => console.error(err));
    }
  }, [venue, isOpen, activeTab]);

  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new window.Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              resolve(blob || file);
            },
            "image/jpeg",
            0.8,
          );
        };
      };
    });
  };

  const handleMenuUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !venue) return;

    setUploadingMenu(true);
    try {
      const compressedBlob = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressedBlob, file.name);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();

      const menuRes = await fetch(
        `/api/venues/${encodeURIComponent(venue.id)}/menu`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoUrl: uploadData.url,
            venue: {
              placeId: venue.id,
              name: venue.name,
              lat: venue.lat,
              lng: venue.lng,
              category: venue.category,
              address: venue.address,
            },
          }),
        },
      );
      if (!menuRes.ok) throw new Error("Menu save failed");
      const menuData = await menuRes.json();

      setMenuPhotos(menuData.menuPhotos);
    } catch (err) {
      console.error("Menu upload error:", err);
      alert("Failed to upload menu photo.");
    } finally {
      setUploadingMenu(false);
    }
  };

  if (!isOpen || !venue) return null;

  const CategoryIcon =
    venue.category === "cafe"
      ? Coffee
      : venue.category === "library"
        ? BookOpen
        : venue.category === "coworking_space"
          ? Building2
          : MapPin;

  const venueFallbacks: Record<string, string> = {
    cafe: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200",
    library:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=1200",
    coworking_space:
      "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&q=80&w=1200",
    default:
      "https://images.unsplash.com/photo-1447366216548-37526070297c?auto=format&fit=crop&q=80&w=1200",
  };

  const displayPhoto =
    photoUrl ||
    venueFallbacks[venue.category || "default"] ||
    venueFallbacks.default;
  const currentScore = liveScore !== null ? liveScore : venue.score;

  const wifiLowConfidence = voteMetrics.wifi.hidden;
  const outletsLowConfidence = venue.hasOutlets && voteMetrics.outlets.hidden;

  const isLibrary = venue.category?.toLowerCase() === "library";
  const silentRoomLowConfidence = isLibrary && voteMetrics.silentRoom.hidden;
  const studyTableLowConfidence = isLibrary && voteMetrics.studyTable.hidden;
  const scannerLowConfidence = isLibrary && voteMetrics.scanner.hidden;

  return (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-zinc-950/95 animate-in fade-in duration-300">
      <div
        className="bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-t-3xl sm:rounded-3xl shadow-[0_20px_100px_rgba(0,0,0,0.9)] border border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-bottom-12 zoom-in-95 duration-500"
        onClick={(e) => e.stopPropagation()}
      >
        {wifiLowConfidence && (
          <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              ⚠️ Community Warning: Users report WiFi might not be available or
              is broken.
            </span>
          </div>
        )}
        {outletsLowConfidence && (
          <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              ⚠️ Community Warning: Users report Power Outlets might be
              unavailable.
            </span>
          </div>
        )}
        {silentRoomLowConfidence && (
          <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              ⚠️ Community Warning: Users report Strict Silent Rooms might be
              unavailable.
            </span>
          </div>
        )}
        {studyTableLowConfidence && (
          <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              ⚠️ Community Warning: Users report Bookable Study Tables might be
              unavailable.
            </span>
          </div>
        )}
        {scannerLowConfidence && (
          <div className="flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/20 px-6 py-2.5 text-xs text-amber-600 dark:text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              ⚠️ Community Warning: Users report Scanners/Printers might be
              unavailable.
            </span>
          </div>
        )}

        <div className="relative h-64 sm:h-80 w-full overflow-hidden">
          {photoLoading ? (
            <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={displayPhoto}
              alt={venue.name}
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-3 bg-white hover:bg-zinc-100 text-black rounded-full shadow-2xl border border-zinc-200 transition-all font-bold active:scale-90"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="absolute bottom-6 left-6 right-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-black bg-blue-600 text-white px-2.5 py-1 rounded shadow-lg">
                <CategoryIcon className="w-3.5 h-3.5" />
                {venue.category?.replace("_", " ")}
              </span>
              {currentScore != null && (
                <span className="text-[10px] tracking-widest uppercase font-black bg-white text-zinc-900 border border-zinc-200 px-2.5 py-1 rounded shadow-lg">
                  VIBE SCORE: {Math.round(currentScore * 10)}%
                </span>
              )}
            </div>
            <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-1 text-shadow-lg">
              {venue.name}
            </h2>
            <div className="flex items-center gap-1.5 text-zinc-300 text-sm font-medium">
              <MapPin className="w-4 h-4 text-blue-400" />
              <span className="truncate">
                {venue.address || "Location details loading..."}
              </span>
            </div>
          </div>
        </div>

        <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-8 py-3 gap-6">
          {[
            { id: "overview", label: "Overview" },
            { id: "reviews", label: t("venue.reviews") },
            { id: "menu", label: "Menus & Prices" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-1 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Section */}

        <div className="p-8 bg-white dark:bg-zinc-900 overflow-y-auto max-h-[calc(90vh-320px)]">
          {activeTab === "overview" && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDistribution(
                      activeDistribution === "wifi" ? null : "wifi",
                    )
                  }
                  className={`p-5 rounded-2xl flex flex-col items-center text-center border transition-all ${
                    activeDistribution === "wifi"
                      ? "bg-blue-500/10 border-blue-500 shadow-md ring-2 ring-blue-500/20 scale-95"
                      : "bg-zinc-50 dark:bg-zinc-800 border-zinc-100 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:scale-[1.02] cursor-pointer"
                  }`}
                >
                  <div className="p-3 rounded-xl bg-blue-500/10 mb-3">
                    <Wifi className="w-6 h-6 text-blue-500" />
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
                    WiFi
                  </span>
                  <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none">
                    {venue.wifiSpeed
                      ? `${venue.wifiSpeed} Mbps`
                      : venue.wifi
                        ? "Fast"
                        : "TBD"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveDistribution(
                      activeDistribution === "outlets" ? null : "outlets",
                    )
                  }
                  className={`p-5 rounded-2xl flex flex-col items-center text-center border transition-all ${
                    activeDistribution === "outlets"
                      ? "bg-orange-500/10 border-orange-500 shadow-md ring-2 ring-orange-500/20 scale-95"
                      : "bg-zinc-50 dark:bg-zinc-800 border-zinc-100 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:scale-[1.02] cursor-pointer"
                  }`}
                >
                  <div className="p-3 rounded-xl bg-orange-500/10 mb-3">
                    <Zap className="w-6 h-6 text-orange-500" />
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
                    Power
                  </span>
                  <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none uppercase tracking-wide">
                    {venue.outletDensity && venue.outletDensity !== "none"
                      ? venue.outletDensity
                          .replace("_", " ")
                          .replace(/\b\w/g, (c: string) => c.toUpperCase())
                      : venue.hasOutlets
                        ? "Yes"
                        : "No"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setActiveDistribution(
                      activeDistribution === "noise" ? null : "noise",
                    )
                  }
                  className={`p-5 rounded-2xl flex flex-col items-center text-center border transition-all ${
                    activeDistribution === "noise"
                      ? "bg-pink-500/10 border-pink-500 shadow-md ring-2 ring-pink-500/20 scale-95"
                      : "bg-zinc-50 dark:bg-zinc-800 border-zinc-100 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 hover:scale-[1.02] cursor-pointer"
                  }`}
                >
                  <div className="p-3 rounded-xl bg-pink-500/10 mb-3">
                    <Volume2 className="w-6 h-6 text-pink-500" />
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
                    Noise
                  </span>
                  <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none capitalize">
                    {venue.noiseLevel || "Normal"}
                  </span>
                </button>

                <div className="bg-zinc-50 dark:bg-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center border border-zinc-100 dark:border-zinc-700">
                  <div className="p-3 rounded-xl bg-amber-500/10 mb-3">
                    <Sun className="w-6 h-6 text-amber-500" />
                  </div>
                  <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">
                    Lighting
                  </span>
                  <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none capitalize text-center leading-tight">
                    {venue.lighting
                      ? venue.lighting.replace("_", " ")
                      : "Normal"}
                  </span>
                </div>
              </div>

              {activeDistribution && (
                <div className="mb-6">
                  <RatingDistribution
                    reviews={reviews}
                    activeMetric={activeDistribution}
                    onClose={() => setActiveDistribution(null)}
                  />
                </div>
              )}

              {wifiPredictions.length > 0 && (
                <div className="mb-6 bg-white dark:bg-zinc-800 p-5 rounded-2xl border border-zinc-100 dark:border-zinc-700 shadow-sm">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200 mb-1 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-blue-500" />
                    AI Wifi Prediction
                  </h3>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-4">
                    Expected speeds based on crowd telemetry
                  </p>
                  <div className="h-40 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={wifiPredictions}>
                        <XAxis
                          dataKey="time"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fontSize: 10, fill: "#888" }}
                        />
                        <YAxis
                          tickFormatter={(value) => `${value} Mbps`}
                          tick={{ fontSize: 10, fill: "#888" }}
                          width={40}
                        />
                        <Tooltip
                          cursor={{ fill: "rgba(0,0,0,0.05)" }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2.5 rounded shadow-xl">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                    {data.time}
                                  </p>
                                  <p className="text-sm font-bold text-blue-600">
                                    {data.download} Mbps (Download)
                                  </p>
                                  <p className="text-sm font-bold text-green-600">
                                    {data.upload} Mbps (Upload)
                                  </p>
                                  <p className="text-sm font-bold text-orange-600">
                                    {data.latency} ms (Latency)
                                  </p>
                                  <p className="text-[10px] uppercase tracking-wider text-zinc-400 mt-1">
                                    Crowd: {data.crowd}
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar
                          dataKey="download"
                          fill="#3b82f6"
                          radius={[4, 4, 0, 0]}
                          name="Download"
                        />
                        <Bar
                          dataKey="upload"
                          fill="#22c55e"
                          radius={[4, 4, 0, 0]}
                          name="Upload"
                        />
                        <Bar
                          dataKey="latency"
                          fill="#f97316"
                          radius={[4, 4, 0, 0]}
                          name="Latency"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Free Street Parking Tag */}
              {!voteMetrics.freeStreetParking.hidden && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                    voteMetrics.freeStreetParking.confidenceScore < 60
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <Car className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-medium font-mono text-[11px]">
                    Street Parking (
                    {voteMetrics.freeStreetParking.confidenceScore}%)
                  </span>

                  <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                    <button
                      onClick={() =>
                        _submitAmenityVote("freeStreetParking", true)
                      }
                      className={`transition-colors ${voteMetrics.freeStreetParking.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                    >
                      👍
                    </button>
                    <button
                      onClick={() =>
                        _submitAmenityVote("freeStreetParking", false)
                      }
                      className={`transition-colors ${voteMetrics.freeStreetParking.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                    >
                      👎
                    </button>
                  </div>
                </div>
              )}

              {/* Paid Garage Tag */}
              {!voteMetrics.paidGarage.hidden && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                    voteMetrics.paidGarage.confidenceScore < 60
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="font-medium font-mono text-[11px]">
                    Paid Garage ({voteMetrics.paidGarage.confidenceScore}%)
                  </span>

                  <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                    <button
                      onClick={() => _submitAmenityVote("paidGarage", true)}
                      className={`transition-colors ${voteMetrics.paidGarage.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                    >
                      👍
                    </button>
                    <button
                      onClick={() => _submitAmenityVote("paidGarage", false)}
                      className={`transition-colors ${voteMetrics.paidGarage.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                    >
                      👎
                    </button>
                  </div>
                </div>
              )}

              {/* Bicycle Rack Tag */}
              {!voteMetrics.bicycleRack.hidden && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                    voteMetrics.bicycleRack.confidenceScore < 60
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <Bike className="w-3.5 h-3.5 text-orange-500" />
                  <span className="font-medium font-mono text-[11px]">
                    Bicycle Rack ({voteMetrics.bicycleRack.confidenceScore}%)
                  </span>

                  <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                    <button
                      onClick={() => _submitAmenityVote("bicycleRack", true)}
                      className={`transition-colors ${voteMetrics.bicycleRack.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                    >
                      👍
                    </button>
                    <button
                      onClick={() => _submitAmenityVote("bicycleRack", false)}
                      className={`transition-colors ${voteMetrics.bicycleRack.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                    >
                      👎
                    </button>
                  </div>
                </div>
              )}

              {/* Secure Motorcycle Parking Tag */}
              {!voteMetrics.secureMotorcycleParking.hidden && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                    voteMetrics.secureMotorcycleParking.confidenceScore < 60
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-medium font-mono text-[11px]">
                    Moto Parking (
                    {voteMetrics.secureMotorcycleParking.confidenceScore}%)
                  </span>

                  <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                    <button
                      onClick={() =>
                        _submitAmenityVote("secureMotorcycleParking", true)
                      }
                      className={`transition-colors ${voteMetrics.secureMotorcycleParking.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                    >
                      👍
                    </button>
                    <button
                      onClick={() =>
                        _submitAmenityVote("secureMotorcycleParking", false)
                      }
                      className={`transition-colors ${voteMetrics.secureMotorcycleParking.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                    >
                      👎
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                <div className="bg-blue-50 dark:bg-blue-900/10 p-5 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                  <h3 className="text-xs font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-2">
                    <Info className="w-4 h-4" />
                    Intelligence Brief
                  </h3>
                  <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed font-medium">
                    Analysis based on Multi-Agent telemetry suggests this{" "}
                    {venue.category || "workspace"}
                    is optimal for{" "}
                    {venue.category === "cafe"
                      ? "collaborative sessions"
                      : "high-focus work"}
                    . Noise floor is {venue.noiseLevel || "ambient"} and
                    connectivity is verified as{" "}
                    {venue.wifi ? "stable" : "pending"}.
                    {venue.hasErgonomic &&
                      " The workspace features verified ergonomic chairs and height-adjustable/standing desks."}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {venue.musicStyle === "lofi" && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                        <span>🎵 Lo-Fi/Chill Beats</span>
                      </div>
                    )}
                    {venue.musicStyle === "classical_jazz" && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                        <span>🎷 Classical/Jazz Background</span>
                      </div>
                    )}
                    {(venue.musicStyle === "no_music" || venue.hasNoMusic) && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                        <span>🔇 No Music Played</span>
                      </div>
                    )}
                    {venue.hasPhoneBooths && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                        <span>📞 Soundproof Booths Available</span>
                      </div>
                    )}
                    {venue.outletLocations &&
                      venue.outletLocations.length > 0 && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                          <span>
                            🔌 Outlets:{" "}
                            {venue.outletLocations
                              .map((l) => l.replace("_", " "))
                              .join(", ")}
                          </span>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* INTERACTIVE AMENITY VERIFICATION TAG TRACKING ROW */}
              <div className="flex flex-col gap-2 mt-6 border-t border-zinc-100 dark:border-zinc-800 pt-4">
                <span className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">
                  Verify Amenities:
                </span>

                <div className="flex flex-wrap gap-2">
                  {/* WiFi Tag Check Node */}
                  {!voteMetrics.wifi.hidden && (
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                        voteMetrics.wifi.confidenceScore < 60
                          ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <Wifi className="w-3.5 h-3.5 text-blue-500" />
                      <span className="font-medium font-mono text-[11px]">
                        WiFi ({voteMetrics.wifi.confidenceScore}%)
                      </span>

                      <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                        <button
                          onClick={() => _submitAmenityVote("wifi", true)}
                          className={`transition-colors ${voteMetrics.wifi.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() => _submitAmenityVote("wifi", false)}
                          className={`transition-colors ${voteMetrics.wifi.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Outlets Tag Check Node */}
                  {venue.hasOutlets && !voteMetrics.outlets.hidden && (
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                        voteMetrics.outlets.confidenceScore < 60
                          ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-yellow-500" />
                      <span className="font-medium font-mono text-[11px]">
                        Outlets ({voteMetrics.outlets.confidenceScore}%)
                      </span>

                      <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                        <button
                          onClick={() => _submitAmenityVote("outlets", true)}
                          className={`transition-colors ${voteMetrics.outlets.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() => _submitAmenityVote("outlets", false)}
                          className={`transition-colors ${voteMetrics.outlets.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Strict Silent Rooms Tag */}
                  {isLibrary && !voteMetrics.silentRoom.hidden && (
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                        voteMetrics.silentRoom.confidenceScore < 60
                          ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <VolumeX className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="font-medium font-mono text-[11px]">
                        Silent Room ({voteMetrics.silentRoom.confidenceScore}%)
                      </span>

                      <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                        <button
                          onClick={() => _submitAmenityVote("silentRoom", true)}
                          className={`transition-colors ${voteMetrics.silentRoom.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() =>
                            _submitAmenityVote("silentRoom", false)
                          }
                          className={`transition-colors ${voteMetrics.silentRoom.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Bookable Study Tables Tag */}
                  {isLibrary && !voteMetrics.studyTable.hidden && (
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                        voteMetrics.studyTable.confidenceScore < 60
                          ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                      <span className="font-medium font-mono text-[11px]">
                        Study Tables ({voteMetrics.studyTable.confidenceScore}%)
                      </span>

                      <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                        <button
                          onClick={() => _submitAmenityVote("studyTable", true)}
                          className={`transition-colors ${voteMetrics.studyTable.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() =>
                            _submitAmenityVote("studyTable", false)
                          }
                          className={`transition-colors ${voteMetrics.studyTable.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Scanners/Printers Tag */}
                  {isLibrary && !voteMetrics.scanner.hidden && (
                    <div
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs transition-all ${
                        voteMetrics.scanner.confidenceScore < 60
                          ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      <Printer className="w-3.5 h-3.5 text-cyan-500" />
                      <span className="font-medium font-mono text-[11px]">
                        Scanners/Printers ({voteMetrics.scanner.confidenceScore}
                        %)
                      </span>

                      <div className="ml-1 flex items-center border-l border-zinc-300 dark:border-zinc-700 pl-1.5 gap-1 text-[10px]">
                        <button
                          onClick={() => _submitAmenityVote("scanner", true)}
                          className={`transition-colors ${voteMetrics.scanner.userVote === true ? "text-green-500" : "hover:text-green-500"}`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() => _submitAmenityVote("scanner", false)}
                          className={`transition-colors ${voteMetrics.scanner.userVote === false ? "text-red-500" : "hover:text-red-500"}`}
                        >
                          👎
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button
                  onClick={() => onGetDirections(venue)}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-4 px-8 rounded-2xl transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                >
                  <Navigation className="w-5 h-5" />
                  Navigate
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={() => onToggleFavorite(venue)}
                    className={`flex-1 flex items-center justify-center gap-2 font-black uppercase tracking-widest py-3 px-6 rounded-2xl transition-all border-2 ${
                      isFavorited
                        ? "bg-red-500 border-red-400 text-white shadow-xl shadow-red-500/20"
                        : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 shadow-md"
                    }`}
                  >
                    <Heart
                      className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`}
                    />
                    {isFavorited ? "Saved" : "Save"}
                  </button>
                  {onRate && (
                    <button
                      onClick={() => onRate(venue)}
                      className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 font-black uppercase tracking-widest py-3 px-6 rounded-2xl transition-all shadow-md active:scale-[0.98]"
                    >
                      <Star className="w-4 h-4" />
                      Rate
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "reviews" && (
            <div className="space-y-4">
              {reviews.length === 0 ? (
                <div className="py-12 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl text-center px-4">
                  <Info className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                  <p className="text-xs font-black uppercase tracking-wider text-zinc-500">
                    {t("venue.noReviewsYet")}
                  </p>
                  <p className="text-[10px] text-zinc-400 mt-1">
                    {t("venue.beTheFirst")}
                  </p>
                </div>
              ) : (
                reviews.map((review: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-4 border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/20 rounded-2xl space-y-3"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase">
                          {review.user?.firstName || "Nomad"}{" "}
                          {review.user?.lastName || "Scout"}
                        </span>
                        <div className="flex items-center gap-1.5 mt-1 text-[9px] font-mono text-zinc-500">
                          <span>
                            {t("venue.wifi")}: {review.wifiQuality}/5
                          </span>
                          <span>•</span>
                          <span>
                            {t("venue.power")}:{" "}
                            {review.hasOutlets ? t("venue.yes") : t("venue.no")}
                          </span>
                          <span>•</span>
                          <span>
                            {t("venue.noise")}: {review.noiseLevel}
                          </span>
                          {review.outletLocations &&
                            review.outletLocations.length > 0 && (
                              <>
                                <span>•</span>
                                <span>
                                  Locations:{" "}
                                  {review.outletLocations
                                    .map((l: string) => l.replace("_", " "))
                                    .join(", ")}
                                </span>
                              </>
                            )}
                        </div>
                      </div>
                      {review.wifiSpeed && (
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-[9px] font-black tracking-wider">
                          {review.wifiSpeed} MBPS
                        </span>
                      )}
                    </div>
                    {review.comment && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 leading-relaxed bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
                          {translatedReviews[review.id] || review.comment}
                        </p>
                        {!translatedReviews[review.id] && (
                          <button
                            onClick={() => handleTranslate(review)}
                            disabled={translatingReviewId === review.id}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-500 hover:text-blue-600 transition-colors disabled:opacity-50"
                          >
                            <Globe2 className="w-3 h-3" />
                            {translatingReviewId === review.id
                              ? t("venue.translating")
                              : t("venue.translate")}
                          </button>
                        )}
                      </div>
                    )}
                    {review.speedtestPhoto && (
                      <button
                        onClick={() => setPreviewPhoto(review.speedtestPhoto)}
                        className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg border border-blue-500/20 transition-all active:scale-95"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {t("venue.viewSpeedtest")}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "menu" && (
            <div className="space-y-6">
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 bg-zinc-50 dark:bg-zinc-800/10 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer transition-all">
                {uploadingMenu ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">
                      Uploading...
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-center">
                    <Camera className="w-8 h-8 text-zinc-400 mb-1" />
                    <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                      Upload Menu / Drink Options
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      Share workspace pricing & menu options
                    </span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleMenuUpload}
                  className="hidden"
                  disabled={uploadingMenu}
                />
              </label>

              {menuPhotos.length === 0 ? (
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest py-8 rounded-2xl border-2 border-dashed border-zinc-100 dark:border-zinc-800 text-center animate-pulse">
                  No menu photos added yet
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {menuPhotos.map((photo: string, i: number) => (
                    <div
                      key={i}
                      className="relative h-32 rounded-xl overflow-hidden border border-zinc-100 dark:border-zinc-800 group/item cursor-pointer"
                      onClick={() => setPreviewPhoto(photo)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt={`Menu ${i + 1}`}
                        className="w-full h-full object-cover transition-transform group-hover/item:scale-105 duration-300"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center justify-center">
                        <Eye className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-[11000] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl border border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewPhoto(null)}
              className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black text-white rounded-full transition-all"
            >
              <X className="w-5 h-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewPhoto}
              alt="Speedtest/Menu Preview"
              className="max-w-full max-h-[90vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
