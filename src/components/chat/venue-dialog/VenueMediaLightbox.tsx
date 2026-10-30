"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Camera,
  Eye,
  Globe2,
  X,
  Loader2,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import type { Venue } from "../ChatMessages";

const venueFallbacks = {
  default:
    "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=800",
};

export interface VenueMediaLightboxProps {
  venue: Venue;
  activeTab?: "overview" | "reviews" | "menu";
  menuPhotos: string[];
  uploadingMenu: boolean;
  onMenuUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  brokenMenuPhotos: Record<number, boolean>;
  setBrokenMenuPhotos: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  previewPhoto: string | null;
  onClosePreview: () => void;
  onOpenPreview: (photo: string) => void;
  previewImageError: boolean;
  setPreviewImageError: (error: boolean) => void;
  allPhotos: string[];
  lightboxIndex: number | null;
  onCloseLightbox: () => void;
  setLightboxIndex: React.Dispatch<React.SetStateAction<number | null>>;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}

export function VenueMediaLightbox({
  venue,
  activeTab,
  menuPhotos = [],
  uploadingMenu = false,
  onMenuUpload,
  brokenMenuPhotos = {},
  setBrokenMenuPhotos,
  previewPhoto,
  onClosePreview,
  onOpenPreview,
  previewImageError = false,
  setPreviewImageError,
  allPhotos = [],
  lightboxIndex,
  onCloseLightbox,
  setLightboxIndex,
  onTouchStart,
  onTouchEnd,
}: VenueMediaLightboxProps) {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // OCR and Menu Translation states
  const [ocrCache, setOcrCache] = useState<Record<string, string>>({});
  const [translationCache, setTranslationCache] = useState<Record<string, string>>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedMenuText, setTranslatedMenuText] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);

  const safeMenuPhotos = menuPhotos ?? [];
  const safeAllPhotos = allPhotos ?? [];
  const venueName = venue?.name || "Venue";

  // Keyboard accessibility: Escape to dismiss, Arrow keys to navigate lightbox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewPhoto) {
          onClosePreview();
          setTranslationError(null);
          setTranslatedMenuText(null);
        } else if (lightboxIndex !== null) {
          onCloseLightbox();
        }
      } else if (lightboxIndex !== null && safeAllPhotos.length > 1) {
        if (e.key === "ArrowLeft") {
          setLightboxIndex((prev) =>
            prev !== null ? (prev - 1 + safeAllPhotos.length) % safeAllPhotos.length : 0,
          );
        } else if (e.key === "ArrowRight") {
          setLightboxIndex((prev) =>
            prev !== null ? (prev + 1) % safeAllPhotos.length : 0,
          );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    previewPhoto,
    lightboxIndex,
    safeAllPhotos,
    onClosePreview,
    onCloseLightbox,
    setLightboxIndex,
  ]);

  /**
   * On-demand OCR processing using dynamically imported Tesseract.js.
   * `tesseract.js` is loaded only when the user triggers menu translation.
   */
  const handleTranslateMenu = async (lang: string) => {
    if (!previewPhoto) return;
    setSelectedLanguage(lang);
    setTranslationError(null);
    setTranslatedMenuText(null);

    const cacheKey = `${previewPhoto}-${lang}`;
    if (translationCache[cacheKey]) {
      setTranslatedMenuText(translationCache[cacheKey]);
      return;
    }

    let extractedText = ocrCache[previewPhoto];
    if (!extractedText) {
      setIsExtracting(true);
      try {
        // Dynamic import of tesseract.js on demand
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng");
        const {
          data: { text },
        } = await worker.recognize(previewPhoto);
        await worker.terminate();

        if (!isMountedRef.current) return;

        extractedText = (text || "").trim();
        setOcrCache((prev) => ({ ...prev, [previewPhoto]: extractedText }));
      } catch (error) {
        console.error("OCR Error:", error);
        if (!isMountedRef.current) return;
        setTranslationError("Unable to extract readable text.");
        setIsExtracting(false);
        return;
      }

      if (!isMountedRef.current) return;
      setIsExtracting(false);
    }

    if (!extractedText) {
      if (!isMountedRef.current) return;
      setTranslationError("No readable menu text found.");
      return;
    }

    setIsTranslating(true);
    try {
      const response = await fetch("/api/menu-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: extractedText, targetLanguage: lang }),
      });
      if (!response.ok) throw new Error("Translation failed");
      const data = await response.json();

      if (!isMountedRef.current) return;

      setTranslatedMenuText(data.translatedText);
      setTranslationCache((prev) => ({
        ...prev,
        [cacheKey]: data.translatedText,
      }));
    } catch (error) {
      console.error("Translation API error:", error);
      if (!isMountedRef.current) return;
      setTranslationError("Translation failed. Please try again.");
    } finally {
      if (isMountedRef.current) {
        setIsTranslating(false);
      }
    }
  };

  return (
    <>
      {/* Menu tab photo gallery */}
      {activeTab === "menu" && (
        <div data-testid="menu-tab-gallery" className="space-y-6">
          <label
            data-testid="upload-menu-label"
            className="flex flex-col items-center justify-center border-2 border-dashed border-white/10 rounded-2xl p-6 bg-black/20 hover:border-white/20 cursor-pointer transition-all"
          >
            {uploadingMenu ? (
              <div
                data-testid="uploading-menu-spinner"
                className="flex flex-col items-center gap-2 py-2"
              >
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 accent-border" />
                <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-black">
                  Uploading...
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-center">
                <Camera className="w-8 h-8 text-zinc-400 mb-1" />
                <span className="text-xs font-black uppercase tracking-wider text-zinc-200">
                  Upload Menu / Drink Options
                </span>
                <span className="text-[10px] text-zinc-400">
                  Share workspace pricing &amp; menu options
                </span>
              </div>
            )}
            <input
              type="file"
              data-testid="menu-file-input"
              accept="image/*"
              onChange={onMenuUpload}
              className="hidden"
              disabled={uploadingMenu}
            />
          </label>

          {safeMenuPhotos.length === 0 ? (
            <p
              data-testid="no-menu-photos"
              className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest py-8 rounded-2xl border-2 border-dashed border-white/5 text-center animate-pulse"
            >
              No menu photos added yet
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {safeMenuPhotos.map((photo: string, i: number) => (
                <div
                  key={i}
                  data-testid={`menu-photo-item-${i}`}
                  className="relative h-32 rounded-xl overflow-hidden border border-white/10 group/item cursor-pointer"
                  onClick={() => onOpenPreview(photo)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    data-testid={`menu-photo-img-${i}`}
                    src={brokenMenuPhotos[i] ? venueFallbacks.default : photo}
                    alt={`Menu ${i + 1}`}
                    className="w-full h-full object-cover transition-transform group-hover/item:scale-105 duration-300"
                    onError={() =>
                      setBrokenMenuPhotos((prev) => ({
                        ...prev,
                        [i]: true,
                      }))
                    }
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

      {/* Speedtest or Menu Photo Preview Modal with OCR */}
      {previewPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image Preview"
          data-testid="preview-modal"
          className="fixed inset-0 z-[11000] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200"
          onClick={() => {
            onClosePreview();
            setTranslationError(null);
            setTranslatedMenuText(null);
          }}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl border border-zinc-800 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header controls for Preview */}
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-10 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
              <div className="pointer-events-auto">
                {activeTab === "menu" && (
                  <div className="relative inline-block text-left group/dropdown">
                    <button
                      type="button"
                      data-testid="translate-menu-btn"
                      className="flex items-center gap-2 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg transition-all text-sm font-medium backdrop-blur-md border border-white/10"
                      aria-label="Translate Menu"
                    >
                      <Globe2 className="w-4 h-4" />
                      Translate Menu ▼
                    </button>
                    <div className="absolute left-0 mt-2 w-40 rounded-xl bg-zinc-900 border border-zinc-800 shadow-xl opacity-0 invisible group-hover/dropdown:opacity-100 group-hover/dropdown:visible transition-all duration-200 overflow-hidden">
                      {["English", "Hindi", "French", "German", "Spanish"].map(
                        (lang) => (
                          <button
                            key={lang}
                            type="button"
                            data-testid={`translate-lang-btn-${lang}`}
                            className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
                            onClick={() => handleTranslateMenu(lang)}
                          >
                            {lang}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                data-testid="close-preview-btn"
                onClick={() => {
                  onClosePreview();
                  setTranslationError(null);
                  setTranslatedMenuText(null);
                }}
                className="p-2 bg-black/60 hover:bg-black text-white rounded-full transition-all backdrop-blur-md border border-white/10 pointer-events-auto"
                aria-label="Close preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Status messages and translation result */}
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 w-11/12 max-w-lg pointer-events-none">
              {(isExtracting || isTranslating) && (
                <div
                  data-testid="translation-loading"
                  className="bg-zinc-900/95 backdrop-blur-md border accent-border-30 rounded-xl p-4 shadow-2xl animate-in slide-in-from-top-4 flex items-center justify-center gap-3"
                >
                  <Loader2 className="w-5 h-5 animate-spin accent-text" />
                  <p className="text-sm font-medium text-zinc-200">
                    {isExtracting ? "Extracting menu text..." : "Translating..."}
                  </p>
                </div>
              )}

              {translationError && (
                <div
                  data-testid="translation-error-banner"
                  className="bg-zinc-900/95 backdrop-blur-md border border-amber-500/30 rounded-xl p-4 shadow-2xl animate-in slide-in-from-top-4 flex items-start gap-3 pointer-events-auto"
                >
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">
                      {translationError}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="dismiss-translation-error-btn"
                    onClick={() => setTranslationError(null)}
                    className="p-1 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-zinc-200"
                    aria-label="Dismiss translation error"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {translatedMenuText && !isExtracting && !isTranslating && (
                <div
                  data-testid="translated-menu-result"
                  className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-xl p-4 shadow-2xl animate-in slide-in-from-top-4 pointer-events-auto max-h-[60vh] overflow-y-auto"
                >
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-zinc-800">
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Globe2 className="w-4 h-4 text-blue-400" />
                      Translated to {selectedLanguage}
                    </h3>
                    <button
                      type="button"
                      data-testid="close-translated-menu-btn"
                      onClick={() => setTranslatedMenuText(null)}
                      className="p-1 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-zinc-200"
                      aria-label="Close translated menu text"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="text-sm text-zinc-300 whitespace-pre-wrap">
                    {translatedMenuText}
                  </div>
                </div>
              )}
            </div>

            {previewImageError ? (
              <div
                data-testid="preview-image-error"
                className="flex flex-col items-center justify-center p-12 bg-zinc-900 text-center min-h-[300px] min-w-[300px] rounded-xl text-zinc-400"
              >
                <AlertTriangle className="w-12 h-12 text-amber-500 mb-3 animate-pulse" />
                <p className="text-sm font-bold uppercase tracking-wider">
                  Preview Image Not Found
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  This image may have expired or is unavailable.
                </p>
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                data-testid="preview-photo-img"
                src={previewPhoto}
                alt="Speedtest/Menu Preview"
                className="max-w-full max-h-[90vh] object-contain"
                onError={() => setPreviewImageError(true)}
              />
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox Modal */}
      {lightboxIndex !== null && safeAllPhotos.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen Photo Lightbox"
          data-testid="fullscreen-lightbox-modal"
          className="fixed inset-0 z-[12000] flex flex-col justify-between p-4 bg-black/95 animate-in fade-in duration-200"
          onClick={onCloseLightbox}
        >
          {/* Header */}
          <div className="w-full flex justify-between items-center z-10 px-4 pt-2">
            <span
              data-testid="lightbox-counter"
              className="text-sm font-semibold text-white/80"
            >
              {lightboxIndex + 1} / {safeAllPhotos.length}
            </span>
            <button
              type="button"
              data-testid="close-lightbox-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseLightbox();
              }}
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-md border border-white/10"
              aria-label="Close lightbox"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Main Content: Prev Button, Image, Next Button */}
          <div className="flex-1 flex items-center justify-between relative max-h-[80vh] px-4 md:px-12">
            {safeAllPhotos.length > 1 && (
              <button
                type="button"
                data-testid="prev-lightbox-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) =>
                    prev !== null
                      ? (prev - 1 + safeAllPhotos.length) % safeAllPhotos.length
                      : 0,
                  );
                }}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-md border border-white/10 hidden sm:block"
                aria-label="Previous photo"
              >
                <ChevronRight className="w-6 h-6 rotate-180" />
              </button>
            )}

            <div
              className="relative max-w-full max-h-full flex items-center justify-center overflow-hidden"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                data-testid="lightbox-main-img"
                src={safeAllPhotos[lightboxIndex] || venueFallbacks.default}
                alt={`${venueName} fullscreen view`}
                className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl select-none transition-transform duration-300"
              />
            </div>

            {safeAllPhotos.length > 1 && (
              <button
                type="button"
                data-testid="next-lightbox-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) =>
                    prev !== null ? (prev + 1) % safeAllPhotos.length : 0,
                  );
                }}
                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-md border border-white/10 hidden sm:block"
                aria-label="Next photo"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Footer Instruction */}
          <div className="text-center py-2 text-xs text-white/40 select-none">
            Use arrow keys to navigate &bull; Swipe on mobile &bull; Click outside
            to close
          </div>
        </div>
      )}
    </>
  );
}

export default VenueMediaLightbox;
