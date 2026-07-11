"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Star } from "lucide-react";

interface VenueRatingDialogProps {
  venueName: string;
  venueId: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (rating: {
    wifiQuality: number;
    hasOutlets: boolean;
    noiseLevel: "quiet" | "moderate" | "loud";
    comment?: string;
    hasErgonomic: boolean;
    outletDensity: "every_table" | "some_tables" | "wall_seats" | "none";
    wifiSpeed?: number;
    speedtestPhoto?: string;
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
  const [noiseLevel, setNoiseLevel] = useState<"quiet" | "moderate" | "loud">("moderate");
  const [comment, setComment] = useState("");
  const [hasErgonomic, setHasErgonomic] = useState(false);
  const [outletDensity, setOutletDensity] = useState<"every_table" | "some_tables" | "wall_seats" | "none">("none");
  const [wifiSpeed, setWifiSpeed] = useState<string>("");
  const [speedtestPhoto, setSpeedtestPhoto] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
        comment: comment.trim() || undefined,
        hasErgonomic,
        outletDensity,
        wifiSpeed: wifiSpeed ? parseInt(wifiSpeed, 10) : undefined,
        speedtestPhoto: speedtestPhoto || undefined,
      });
      
      // Reset form
      setWifiQuality(3);
      setHasOutlets(null);
      setNoiseLevel("moderate");
      setComment("");
      setHasErgonomic(false);
      setOutletDensity("none");
      setWifiSpeed("");
      setSpeedtestPhoto(null);
      onClose();
    } catch (error) {
      console.error("Error submitting rating:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mounted) return null;

  const dialogContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Rate {venueName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* WiFi Quality */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              WiFi Quality
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setWifiQuality(rating)}
                  className={`p-2 rounded-lg transition-colors ${
                    rating <= wifiQuality
                      ? "bg-blue-100 dark:bg-blue-900/20"
                      : "bg-zinc-100 dark:bg-zinc-800"
                  }`}
                >
                  <Star
                    className={`w-6 h-6 ${
                      rating <= wifiQuality
                        ? "text-blue-600 fill-current"
                        : "text-zinc-400"
                    }`}
                  />
                </button>
              ))}
              <span className="ml-2 text-sm text-zinc-600 dark:text-zinc-400">
                {wifiQuality}/5
              </span>
            </div>
          </div>

          {/* Outlets */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Power Outlets Available?
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setHasOutlets(true)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  hasOutlets === true
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setHasOutlets(false)}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  hasOutlets === false
                    ? "bg-red-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                }`}
              >
                No
              </button>
            </div>
          </div>

          {/* Noise Level */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Noise Level
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["quiet", "moderate", "loud"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setNoiseLevel(level)}
                  className={`px-4 py-2 rounded-lg font-medium capitalize transition-colors ${
                    noiseLevel === level
                      ? level === "quiet"
                        ? "bg-green-600 text-white"
                        : level === "moderate"
                        ? "bg-orange-600 text-white"
                        : "bg-red-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Wi-Fi Speed (Mbps) */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Verified Wi-Fi Speed (Mbps - Optional)
            </label>
            <input
              type="number"
              value={wifiSpeed}
              onChange={(e) => setWifiSpeed(e.target.value)}
              placeholder="e.g. 80"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Speedtest Photo Upload */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
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
          </div>

          {/* Power Outlet Density */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Power Outlet Density
            </label>
            <select
              value={outletDensity}
              onChange={(e) => setOutletDensity(e.target.value as any)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="none">None / No Outlets</option>
              <option value="every_table">Every Table</option>
              <option value="some_tables">Some Tables</option>
              <option value="wall_seats">Wall Seats Only</option>
            </select>
          </div>

          {/* Ergonomic Setup */}
          <div className="flex items-center justify-between p-1">
            <label className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              Features Ergonomic Seating/Desks?
            </label>
            <input
              type="checkbox"
              checked={hasErgonomic}
              onChange={(e) => setHasErgonomic(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-blue-600 focus:ring-blue-500"
            />
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-50 mb-2">
              Comments (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Share your experience..."
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 rounded-lg font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || hasOutlets === null}
              className="flex-1 px-4 py-2 rounded-lg font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? "Submitting..." : "Submit Rating"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
}
