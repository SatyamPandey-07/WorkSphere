"use client";

import { useState, useEffect, useMemo, useRef, useTransition } from "react";
import type { Venue } from "./ChatMessages";
import { summarizeReviewSentiment } from "@/lib/reviewSentiment";
import {
  subscribeReviewSyncEvents,
  getQueuedReviews,
  resolveReviewConflict,
  QueuedVenueReview,
} from "@/lib/offlineReviewSync";
import type { HourlyForecast } from "@/components/noise/NoiseTimelineChart";

import {
  VenueHeaderSection,
  VenueDescriptionAndHostCard,
  VenueActionButtons,
} from "./venue-dialog/VenueHeaderSection";
import { VenueMediaLightbox } from "./venue-dialog/VenueMediaLightbox";
import { VenueNoiseSection } from "./venue-dialog/VenueNoiseSection";
import { VenueAmenityVoting } from "./venue-dialog/VenueAmenityVoting";
import { VenueReviewsSection } from "./venue-dialog/VenueReviewsSection";
import { useVenueAmenityVotes } from "./venue-dialog/useVenueAmenityVotes";

const venueFallbacks = {
  cafe: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=800",
  library:
    "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=800",
  coworking:
    "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=800",
  default:
    "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=800",
};

export interface VenueDetailDialogProps {
  venue: Venue | null;
  isOpen: boolean;
  isFavorited: boolean;
  onClose: () => void;
  onGetDirections: (venue: Venue) => void;
  onToggleFavorite: (venue: Venue) => void;
  onRate?: (venue: Venue) => void;
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
  const [imageError, setImageError] = useState(false);
  const [previewImageError, setPreviewImageError] = useState(false);
  const [brokenMenuPhotos, setBrokenMenuPhotos] = useState<
    Record<number, boolean>
  >({});
  const [photos, setPhotos] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [enableTransition, setEnableTransition] = useState(false);
  const [translatingReviewId, setTranslatingReviewId] = useState<string | null>(
    null,
  );
  const [translatedReviews, setTranslatedReviews] = useState<
    Record<string, string>
  >({});
  const [activeDistribution, setActiveDistribution] = useState<
    "wifi" | "outlets" | "noise" | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [showFlagMenu, setShowFlagMenu] = useState(false);
  const [flagSubmitted, setFlagSubmitted] = useState(false);
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  // Accessibility plumbing for the dialog container
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const lightboxOpenRef = useRef(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "menu">(
    "overview",
  );
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const sentiment = useMemo(() => summarizeReviewSentiment(reviews), [reviews]);
  const [conflictReview, setConflictReview] =
    useState<QueuedVenueReview | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [menuPhotos, setMenuPhotos] = useState<string[]>([]);
  const [uploadingMenu, setUploadingMenu] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  useEffect(() => {
    setPreviewImageError(false);
  }, [previewPhoto]);

  const [wifiPredictions, setWifiPredictions] = useState<any[]>([]);
  const [occupancyData, setOccupancyData] = useState<any[]>([]);
  const [noiseForecast, setNoiseForecast] = useState<HourlyForecast[]>([]);

  // Amenity Votes hook
  const {
    voteMetrics,
    submitAmenityVote,
    showVoteBreakdown,
    setShowVoteBreakdown,
    showLeaderboard,
    setShowLeaderboard,
    leaderboard,
  } = useVenueAmenityVotes(venue?.id, isOpen);

  // Venue Description Translation state
  const [selectedVenueLang, setSelectedVenueLang] = useState<string>("EN");
  const [translatedDescription, setTranslatedDescription] =
    useState<string>("");
  const [isTranslatingDesc, startDescTransition] = useTransition();
  const [descTranslationError, setDescTranslationError] = useState<
    string | null
  >(null);
  const [descriptionCache, setDescriptionCache] = useState<
    Record<string, string>
  >({});

  const handleVenueDescriptionTranslation = async (targetLang: string) => {
    if (!venue) return;
    setSelectedVenueLang(targetLang);
    setDescTranslationError(null);

    const rawDescription =
      venue.description ||
      `Analysis based on Multi-Agent telemetry suggests this ${venue.category || "workspace"} is optimal for collaborative sessions.`;

    if (targetLang === "EN") {
      setTranslatedDescription("");
      return;
    }

    const cacheKey = `${venue.id}-${targetLang}`;
    if (descriptionCache[cacheKey]) {
      setTranslatedDescription(descriptionCache[cacheKey]);
      return;
    }

    startDescTransition(async () => {
      try {
        const response = await fetch(
          `/api/venues/${encodeURIComponent(venue.id)}/translate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetLang, text: rawDescription }),
          },
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            data.error || "Failed to translate venue description",
          );
        }

        const translatedText = data.translatedDescription || rawDescription;
        setTranslatedDescription(translatedText);
        setDescriptionCache((prev) => ({
          ...prev,
          [cacheKey]: translatedText,
        }));
      } catch (err: any) {
        console.error("Venue Description Translation Error:", err);
        setDescTranslationError(err.message || "Translation unavailable.");
      }
    });
  };

  const [quickSaveLoading, setQuickSaveLoading] = useState(false);

  const handleQuickSave = async () => {
    if (quickSaveLoading || !venue) return;
    setQuickSaveLoading(true);
    try {
      const res = await fetch("/api/folders");
      if (!res.ok) {
        alert("Failed to save venue. Unable to load collections.");
        setQuickSaveLoading(false);
        return;
      }
      const data = await res.json();
      if (!data.folders || data.folders.length === 0) {
        alert(
          "You don't have any collections yet. Please create one to save venues.",
        );
        setQuickSaveLoading(false);
        return;
      }

      const primaryFolder = data.folders[0];
      const saveRes = await fetch(`/api/folders/${primaryFolder.id}/venues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue }),
      });

      if (saveRes.ok) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        await fetch(`/api/folders/${primaryFolder.id}/refresh`, {
          method: "POST",
          signal: controller.signal,
        })
          .catch(() => {})
          .finally(() => clearTimeout(timeoutId));
        alert(`Saved to ${primaryFolder.name}!`);
      } else {
        const errorData = await saveRes.json().catch(() => ({}));
        if (errorData.error === "Venue already in folder") {
          alert("Already saved to this collection");
        } else {
          alert(
            "Failed to save venue. It might already be in your collection.",
          );
        }
      }
    } catch (e) {
      console.error(e);
      alert("An error occurred while saving the venue.");
    } finally {
      setQuickSaveLoading(false);
    }
  };

  const submitFlag = async (reason: string) => {
    if (!venue) return;
    setFlagSubmitting(true);
    setShowFlagMenu(false);
    try {
      await fetch(`/api/venues/${venue.id}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      setFlagSubmitted(true);
      setTimeout(() => setFlagSubmitted(false), 3000);
    } catch {
      // silently fail — UI resets
    } finally {
      setFlagSubmitting(false);
    }
  };

  const handleShare = () => {
    if (!venue) return;
    const url = `${window.location.origin}/venues/${venue.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTranslateReview = async (review: any) => {
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

  useEffect(() => {
    const timer = setTimeout(() => setEnableTransition(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!venue) return;
    setLiveScore(venue.score ?? null);
    setPhotoLoading(true);
    setImageError(false);
    setBrokenMenuPhotos({});
    setActiveTab("overview");
    setActiveDistribution(null);
    setPhotos([]);
    setLightboxIndex(null);
    setNoiseForecast([]);
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

    fetch(`/api/venues/enrich?${params}`)
      .then((response) => {
        if (response.ok) return response.json();
        throw new Error("Failed to enrich");
      })
      .then((data) => {
        if (data && data.photos && data.photos.length > 0) {
          setPhotos(data.photos);
        }
      })
      .catch(() => {
        // Fallback to single photoUrl
      });
  }, [venue]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    const list = photos.length > 0 ? photos : photoUrl ? [photoUrl] : [];
    if (lightboxIndex === null || list.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxIndex(null);
      } else if (e.key === "ArrowRight") {
        setLightboxIndex((prev) =>
          prev !== null ? (prev + 1) % list.length : 0,
        );
      } else if (e.key === "ArrowLeft") {
        setLightboxIndex((prev) =>
          prev !== null ? (prev - 1 + list.length) % list.length : 0,
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxIndex, photos, photoUrl]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const list = photos.length > 0 ? photos : photoUrl ? [photoUrl] : [];
    if (touchStartX === null || list.length === 0) return;
    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchStartX - touchEndX;

    if (Math.abs(diffX) > 50) {
      if (diffX > 0) {
        setLightboxIndex((prev) =>
          prev !== null ? (prev + 1) % list.length : 0,
        );
      } else {
        setLightboxIndex((prev) =>
          prev !== null ? (prev - 1 + list.length) % list.length : 0,
        );
      }
    }
    setTouchStartX(null);
  };

  // Real-time SSE updates
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

  // Fetch reviews on dialog open / venue change and subscribe to offline sync events
  useEffect(() => {
    if (!venue || !isOpen) return;
    setReviewsLoading(true);
    fetch(`/api/venues/${encodeURIComponent(venue.id)}/reviews`)
      .then((r) => r.json())
      .then((data) => {
        if (data.reviews) setReviews(data.reviews);
      })
      .catch((err) => console.error(err))
      .finally(() => setReviewsLoading(false));

    // Check for any pending review conflicts for this venue in IndexedDB
    getQueuedReviews()
      .then((items) => {
        const found = items.find(
          (i) => i.venueId === venue.id && i.status === "CONFLICT",
        );
        setConflictReview(found || null);
      })
      .catch(() => {});

    // Listen for background sync success or conflict notifications
    const unsubscribe = subscribeReviewSyncEvents((event) => {
      if (!event.venueId || event.venueId === venue.id) {
        if (event.type === "REVIEW_SYNC_SUCCESS") {
          fetch(`/api/venues/${encodeURIComponent(venue.id)}/reviews`)
            .then((r) => r.json())
            .then((data) => {
              if (data.reviews) setReviews(data.reviews);
            })
            .catch(() => {});
          setConflictReview(null);
        } else if (event.type === "REVIEW_SYNC_CONFLICT") {
          getQueuedReviews()
            .then((items) => {
              const found = items.find(
                (i) => i.venueId === venue.id && i.status === "CONFLICT",
              );
              setConflictReview(found || null);
            })
            .catch(() => {});
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [venue, isOpen]);

  const handleResolveConflict = async (choice: "KEEP_LOCAL" | "USE_REMOTE") => {
    if (!conflictReview || !venue) return;
    setResolvingConflict(true);
    try {
      await resolveReviewConflict(conflictReview.id, choice);
      setConflictReview(null);
      const res = await fetch(
        `/api/venues/${encodeURIComponent(venue.id)}/reviews`,
      );
      const data = await res.json();
      if (data.reviews) setReviews(data.reviews);
    } catch (err) {
      console.error("Failed to resolve review conflict:", err);
    } finally {
      setResolvingConflict(false);
    }
  };

  // Fetch predictions and menu photos based on active tab
  useEffect(() => {
    if (!venue || !isOpen) return;

    if (activeTab === "overview") {
      fetch(`/api/venues/${encodeURIComponent(venue.id)}/wifi-prediction`)
        .then((r) => r.json())
        .then((data) => {
          if (data.predictions) setWifiPredictions(data.predictions);
        })
        .catch((err) => console.error(err));

      fetch(`/api/venues/${encodeURIComponent(venue.id)}/telemetry`)
        .then((r) => r.json())
        .then((data) => {
          if (data.occupancy) setOccupancyData(data.occupancy);
        })
        .catch((err) => console.error(err));

      fetch(
        `/api/venues/${encodeURIComponent(venue.id)}/noise-metrics/forecast`,
      )
        .then((r) => r.json())
        .then((data) => {
          if (data && data.forecast) {
            const hasRealData = data.forecast.some(
              (f: HourlyForecast) => f.predictedDb !== null,
            );
            if (hasRealData) {
              setNoiseForecast(data.forecast);
            } else {
              setNoiseForecast(
                generateMockNoiseForecast(venue.category || "default"),
              );
            }
          } else {
            setNoiseForecast(
              generateMockNoiseForecast(venue.category || "default"),
            );
          }
        })
        .catch((err) => {
          console.error(err);
          setNoiseForecast(
            generateMockNoiseForecast(venue.category || "default"),
          );
        });
    } else if (activeTab === "reviews") {
      setReviewsLoading(true);
      fetch(`/api/venues/${encodeURIComponent(venue.id)}/reviews`)
        .then((r) => r.json())
        .then((data) => {
          if (data.reviews) setReviews(data.reviews);
        })
        .catch((err) => console.error(err))
        .finally(() => setReviewsLoading(false));
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

  // Keyboard navigation & escape closing for accessibility
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    lightboxOpenRef.current = lightboxIndex !== null;
  }, [lightboxIndex]);

  useEffect(() => {
    if (!isOpen) return;

    const el = dialogRef.current;
    if (el) {
      const focusTarget =
        (el.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) as HTMLElement | null) ?? el;
      focusTarget.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!lightboxOpenRef.current) {
          onCloseRef.current();
        }
        return;
      }

      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const focusableArray = Array.from(focusable).filter(
          (item) => !item.hasAttribute("disabled") && item.offsetParent !== null,
        );

        if (focusableArray.length === 0) return;

        const firstElement = focusableArray[0];
        const lastElement = focusableArray[focusableArray.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === firstElement ||
            !dialog.contains(document.activeElement)
          ) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (
            document.activeElement === lastElement ||
            !dialog.contains(document.activeElement)
          ) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (!isOpen || !venue) return null;

  const isLibrary = venue.category?.toLowerCase() === "library";
  const displayPhoto =
    photoUrl && !imageError
      ? photoUrl
      : venue.category === "cafe"
        ? venueFallbacks.cafe
        : venue.category === "library"
          ? venueFallbacks.library
          : venue.category === "coworking_space"
            ? venueFallbacks.coworking
            : venueFallbacks.default;

  const allPhotos = photos.length > 0 ? photos : [displayPhoto];
  const currentScore = liveScore !== null ? liveScore : venue.score;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-zinc-950/95 animate-in fade-in duration-300"
      style={{ touchAction: "pan-y" }}
    >
      {/* CSS Block for Glassmorphism Gradient Border Animation */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes glassBorderCycle {
          0% { border-color: rgba(59, 130, 246, 0.5); }
          33% { border-color: rgba(168, 85, 247, 0.5); }
          66% { border-color: rgba(6, 182, 212, 0.5); }
          100% { border-color: rgba(59, 130, 246, 0.5); }
        }
        .glass-animated-border {
          border-width: 1px;
          border-style: solid;
          animation: glassBorderCycle 4s linear infinite;
        }
      `,
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${venue.name} details`}
        tabIndex={-1}
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-t-3xl sm:rounded-3xl shadow-[0_20px_100px_rgba(0,0,0,0.9)] animate-in slide-in-from-bottom-12 zoom-in-95 duration-500 bg-zinc-900 supports-[backdrop-filter]:bg-white/[0.08] supports-[backdrop-filter]:backdrop-blur-[20px] glass-animated-border flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modular Header Component */}
        <VenueHeaderSection
          venue={venue}
          currentScore={currentScore ?? null}
          displayPhoto={displayPhoto}
          photoLoading={photoLoading}
          setImageError={setImageError}
          sentiment={sentiment}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={onClose}
          onOpenLightbox={(idx = 0) => setLightboxIndex(idx)}
          voteMetrics={voteMetrics}
          isLibrary={isLibrary}
          quickSaveLoading={quickSaveLoading}
          onQuickSave={handleQuickSave}
          selectedVenueLang={selectedVenueLang}
          onSelectVenueLang={handleVenueDescriptionTranslation}
          isTranslatingDesc={isTranslatingDesc}
          descTranslationError={descTranslationError}
          translatedDescription={translatedDescription}
          onGetDirections={onGetDirections}
          onToggleFavorite={onToggleFavorite}
          isFavorited={isFavorited}
          enableTransition={enableTransition}
          onRate={onRate}
          showFlagMenu={showFlagMenu}
          setShowFlagMenu={setShowFlagMenu}
          flagSubmitting={flagSubmitting}
          flagSubmitted={flagSubmitted}
          onSubmitFlag={submitFlag}
          copied={copied}
          onShare={handleShare}
        />

        {/* Modular Body Content Section */}
        <div className="p-8 bg-transparent overflow-y-auto flex-1 min-h-0 text-zinc-100">
          {activeTab === "overview" && (
            <>
              {/* Description & Host Card */}
              <VenueDescriptionAndHostCard
                venue={venue}
                selectedVenueLang={selectedVenueLang}
                onSelectVenueLang={handleVenueDescriptionTranslation}
                isTranslatingDesc={isTranslatingDesc}
                descTranslationError={descTranslationError}
                translatedDescription={translatedDescription}
              />

              {/* Noise Section */}
              <VenueNoiseSection
                venue={venue}
                reviews={reviews}
                wifiPredictions={wifiPredictions}
                occupancyData={occupancyData}
                noiseForecast={noiseForecast}
                activeDistribution={activeDistribution}
                setActiveDistribution={setActiveDistribution}
              />

              {/* Amenity Voting Section */}
              <VenueAmenityVoting
                venue={venue}
                voteMetrics={voteMetrics}
                submitAmenityVote={submitAmenityVote}
                showVoteBreakdown={showVoteBreakdown}
                setShowVoteBreakdown={setShowVoteBreakdown}
                showLeaderboard={showLeaderboard}
                setShowLeaderboard={setShowLeaderboard}
                leaderboard={leaderboard}
                isLibrary={isLibrary}
              />

              {/* Action Buttons */}
              <VenueActionButtons
                venue={venue}
                onGetDirections={onGetDirections}
                onToggleFavorite={onToggleFavorite}
                isFavorited={isFavorited}
                enableTransition={enableTransition}
                onRate={onRate}
                showFlagMenu={showFlagMenu}
                setShowFlagMenu={setShowFlagMenu}
                flagSubmitting={flagSubmitting}
                flagSubmitted={flagSubmitted}
                onSubmitFlag={submitFlag}
                copied={copied}
                onShare={handleShare}
              />
            </>
          )}

          {activeTab === "reviews" && (
            <VenueReviewsSection
              venue={venue}
              reviews={reviews}
              reviewsLoading={reviewsLoading}
              conflictReview={conflictReview}
              resolvingConflict={resolvingConflict}
              onResolveConflict={handleResolveConflict}
              translatedReviews={translatedReviews}
              translatingReviewId={translatingReviewId}
              onTranslateReview={handleTranslateReview}
              onViewSpeedtestPhoto={(photo) => setPreviewPhoto(photo)}
            />
          )}

          {activeTab === "menu" && (
            <VenueMediaLightbox
              venue={venue}
              activeTab="menu"
              menuPhotos={menuPhotos}
              uploadingMenu={uploadingMenu}
              onMenuUpload={handleMenuUpload}
              brokenMenuPhotos={brokenMenuPhotos}
              setBrokenMenuPhotos={setBrokenMenuPhotos}
              previewPhoto={previewPhoto}
              onClosePreview={() => setPreviewPhoto(null)}
              onOpenPreview={(photo) => setPreviewPhoto(photo)}
              previewImageError={previewImageError}
              setPreviewImageError={setPreviewImageError}
              allPhotos={allPhotos}
              lightboxIndex={lightboxIndex}
              onCloseLightbox={() => setLightboxIndex(null)}
              setLightboxIndex={setLightboxIndex}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            />
          )}
        </div>
      </div>

      {/* Lightbox / Preview modal available on all tabs */}
      {activeTab !== "menu" && (
        <VenueMediaLightbox
          venue={venue}
          menuPhotos={menuPhotos}
          uploadingMenu={uploadingMenu}
          onMenuUpload={handleMenuUpload}
          brokenMenuPhotos={brokenMenuPhotos}
          setBrokenMenuPhotos={setBrokenMenuPhotos}
          previewPhoto={previewPhoto}
          onClosePreview={() => setPreviewPhoto(null)}
          onOpenPreview={(photo) => setPreviewPhoto(photo)}
          previewImageError={previewImageError}
          setPreviewImageError={setPreviewImageError}
          allPhotos={allPhotos}
          lightboxIndex={lightboxIndex}
          onCloseLightbox={() => setLightboxIndex(null)}
          setLightboxIndex={setLightboxIndex}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        />
      )}
    </div>
  );
}

function generateMockNoiseForecast(category: string): HourlyForecast[] {
  const isLibrary = category.toLowerCase() === "library";
  const isCafe = category.toLowerCase() === "cafe";
  const isCoworking = category.toLowerCase() === "coworking_space";

  const baseDb = isLibrary ? 35 : isCafe ? 55 : isCoworking ? 45 : 45;
  const mockForecast: HourlyForecast[] = [];

  for (let hour = 0; hour < 24; hour++) {
    let dev = 0;
    if (hour >= 8 && hour <= 22) {
      if (hour >= 11 && hour <= 14) {
        dev = isCafe ? 15 : isLibrary ? 5 : 10;
      } else if (hour >= 18 && hour <= 21) {
        dev = isCafe ? 12 : isLibrary ? 3 : 8;
      } else {
        dev = isCafe ? 8 : isLibrary ? 2 : 5;
      }
    } else {
      dev = -5;
    }

    const variation = Math.sin(hour) * 1.5;
    const predictedDb = Math.round((baseDb + dev + variation) * 10) / 10;

    mockForecast.push({
      hour,
      predictedDb: Math.max(30, Math.min(90, predictedDb)),
      confidence: 0.5,
      samples: 0,
    });
  }

  return mockForecast;
}

export default VenueDetailDialog;
