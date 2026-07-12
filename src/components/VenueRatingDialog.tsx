"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import {
  NoiseMeasurement,
  NoiseMeter,
} from "@/components/noise/NoiseMeter";

interface VenueRatingDialogProps {
  venueName: string;
  venueId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    avgDecibels?: number;
    peakDecibels?: number;
    comment?: string;
    hasErgonomic: boolean;
    outletDensity: "every_table" | "some_tables" | "wall_seats" | "none";
    wifiSpeed?: number;
    lighting?: "natural_daylight" | "warm_ambient" | "fluorescent" | "bright_white";
    speedtestPhoto?: string;
    hasPhoneBooths?: boolean;
    hasNoMusic?: boolean;
    hasQuietZone?: boolean;
  }) => void;
}

export function VenueRatingDialog({
  venueName,
  venueId: _venueId,
  isOpen,
  onClose,
  onSubmit,
}: VenueRatingDialogProps) {
  const [wifiQuality, setWifiQuality] = useState(3);
  const [hasOutlets, setHasOutlets] = useState<boolean | null>(null);
  const [noiseLevel, setNoiseLevel] = useState<
    "quiet" | "moderate" | "loud"
  >("moderate");
  const [measurement, setMeasurement] = useState<NoiseMeasurement | null>(null);
  const [comment, setComment] = useState("");
  const [hasErgonomic, setHasErgonomic] = useState(false);
  const [outletDensity, setOutletDensity] = useState<
    "every_table" | "some_tables" | "wall_seats" | "none"
  >("none");
  const [wifiSpeed, setWifiSpeed] = useState("");
  const [speedtestPhoto, setSpeedtestPhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hasPhoneBooths, setHasPhoneBooths] = useState(false);
  const [hasNoMusic, setHasNoMusic] = useState(false);
  const [hasQuietZone, setHasQuietZone] = useState(false);
  const [lighting, setLighting] = useState<"natural_daylight" | "warm_ambient" | "fluorescent" | "bright_white" | "">("");

  useEffect(() => {
    setMounted(true);
  }, []);

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
            0.8
          );
        };
      };
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      const compressedBlob = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressedBlob, file.name);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setSpeedtestPhoto(data.url);
    } catch (err) {
      console.error("Photo upload error:", err);
      alert("Failed to upload screenshot. Please try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (hasOutlets === null) {
      alert("Please indicate if outlets are available");
      return;
    }

    setIsSubmitting(true);

    try {
      await onSubmit({
        wifiQuality,
        hasOutlets,
        noiseLevel,
        avgDecibels: measurement?.averageDb,
        peakDecibels: measurement?.peakDb,
        comment: comment.trim() || undefined,
        hasErgonomic,
        outletDensity,
        wifiSpeed: wifiSpeed ? parseInt(wifiSpeed, 10) : undefined,
        lighting: lighting || undefined,
        speedtestPhoto: speedtestPhoto || undefined,
        hasPhoneBooths,
        hasNoMusic,
        hasQuietZone,
      });

      setWifiQuality(3);
      setHasOutlets(null);
      setNoiseLevel("moderate");
      setMeasurement(null);
      setComment("");
      setHasErgonomic(false);
      setOutletDensity("none");
      setWifiSpeed("");
      setSpeedtestPhoto(null);
      setHasPhoneBooths(false);
      setHasNoMusic(false);
      setHasQuietZone(false);
      setLighting("");
      onClose();
    } catch (error) {
      console.error("Error submitting rating:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              Rate {venueName}
            </h2>
            <p className="text-xs text-zinc-500">
              Add subjective feedback and optional measured noise data.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-5">
          <section>
            <label className="mb-2 block text-sm font-medium">
              WiFi Quality
            </label>

            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setWifiQuality(rating)}
                  className={`rounded-lg p-2 transition ${
                    rating <= wifiQuality
                      ? "bg-blue-100 text-blue-600 dark:bg-blue-900/30"
                      : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
                  }`}
                >
                  <Star className="h-5 w-5 fill-current" />
                </button>
              ))}

              <span className="ml-2 text-sm text-zinc-500">
                {wifiQuality}/5
              </span>
            </div>
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Power Outlets Available?
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setHasOutlets(true)}
                className={`flex-1 rounded-lg px-4 py-2 font-medium ${
                  hasOutlets === true
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                Yes
              </button>

              <button
                type="button"
                onClick={() => setHasOutlets(false)}
                className={`flex-1 rounded-lg px-4 py-2 font-medium ${
                  hasOutlets === false
                    ? "bg-red-600 text-white"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                No
              </button>
            </div>
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Subjective Noise Level
            </label>

            <div className="grid grid-cols-3 gap-2">
              {(["quiet", "moderate", "loud"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setNoiseLevel(level)}
                  className={`rounded-lg px-4 py-2 font-medium capitalize ${
                    noiseLevel === level
                      ? level === "quiet"
                        ? "bg-green-600 text-white"
                        : level === "moderate"
                          ? "bg-orange-600 text-white"
                          : "bg-red-600 text-white"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </section>

          <NoiseMeter onMeasured={setMeasurement} />

          <section>
            <label className="mb-2 block text-sm font-medium">
              Verified Wi-Fi Speed (Mbps - Optional)
            </label>

            <input
              type="number"
              value={wifiSpeed}
              onChange={(event) => setWifiSpeed(event.target.value)}
              placeholder="e.g. 80"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </section>

          {/* Speedtest Photo Upload */}
          <section>
            <label className="mb-2 block text-sm font-medium">
              Speedtest Screenshot (Optional)
            </label>
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-zinc-50 dark:bg-zinc-800/20 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
              {uploadingPhoto ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="text-xs text-zinc-500">Processing & uploading image...</span>
                </div>
              ) : speedtestPhoto ? (
                <div className="w-full flex flex-col items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={speedtestPhoto}
                    alt="Speedtest Screenshot"
                    className="max-h-32 object-contain rounded-lg border border-zinc-200 dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => setSpeedtestPhoto(null)}
                    className="px-3 py-1.5 bg-red-100 dark:bg-red-900/20 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-200 transition-colors"
                  >
                    Remove Photo
                  </button>
                </div>
              ) : (
                <label className="w-full h-full flex flex-col items-center justify-center cursor-pointer gap-2 py-4">
                  <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                  </svg>
                  <span className="text-xs text-zinc-500 font-medium">Click to select speedtest image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </section>

          {/* Power Outlet Density */}
          <section>
            <label className="mb-2 block text-sm font-medium">
              Power Outlet Density
            </label>

            <select
              value={outletDensity}
              onChange={(event) =>
                setOutletDensity(
                  event.target.value as
                    | "every_table"
                    | "some_tables"
                    | "wall_seats"
                    | "none",
                )
              }
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="none">None / No Outlets</option>
              <option value="every_table">Every Table</option>
              <option value="some_tables">Some Tables</option>
              <option value="wall_seats">Wall Seats Only</option>
            </select>
          </section>

          {/* Lighting Quality */}
          <section>
            <label className="mb-2 block text-sm font-medium">
              Lighting Environment
            </label>

            <select
              value={lighting}
              onChange={(event) =>
                setLighting(
                  event.target.value as
                    | "natural_daylight"
                    | "warm_ambient"
                    | "fluorescent"
                    | "bright_white"
                    | ""
                )
              }
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">Not Specified</option>
              <option value="natural_daylight">Natural Daylight</option>
              <option value="warm_ambient">Warm Ambient</option>
              <option value="fluorescent">Fluorescent</option>
              <option value="bright_white">Bright White</option>
            </select>
          </section>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={hasErgonomic}
              onChange={(event) => setHasErgonomic(event.target.checked)}
              className="h-4 w-4 rounded"
            />
            Features Ergonomic Seating/Desks?
          </label>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={hasPhoneBooths}
              onChange={(event) => setHasPhoneBooths(event.target.checked)}
              className="h-4 w-4 rounded"
            />
            Phone Booths Available?
          </label>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={hasNoMusic}
              onChange={(event) => setHasNoMusic(event.target.checked)}
              className="h-4 w-4 rounded"
            />
            No Background Music?
          </label>

          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={hasQuietZone}
              onChange={(event) => setHasQuietZone(event.target.checked)}
              className="h-4 w-4 rounded"
            />
            Strict Silence / Quiet Zones?
          </label>

          <section>
            <label className="mb-2 block text-sm font-medium">
              Comments (optional)
            </label>

            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Share your experience..."
              rows={3}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
            />
          </section>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-zinc-100 px-4 py-2 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting || hasOutlets === null}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Submitting..." : "Submit Rating"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
