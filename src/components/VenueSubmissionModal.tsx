"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { X, MapPin, Wifi, Zap, Volume2, Send, Loader2 } from "lucide-react";

interface VenueSubmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  userLocation?: { lat: number; lng: number };
  onSubmitSuccess?: () => void;
}

interface VenueFormData {
  name: string;
  address: string;
  category: "cafe" | "coworking" | "library";
  latitude: number | null;
  longitude: number | null;
  wifiQuality: number;
  hasOutlets: boolean;
  noiseLevel: "quiet" | "moderate" | "loud";
  description: string;
}

export function VenueSubmissionModal({
  isOpen,
  onClose,
  userLocation,
  onSubmitSuccess,
}: VenueSubmissionModalProps) {
  const { isSignedIn } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState<VenueFormData>({
    name: "",
    address: "",
    category: "cafe",
    latitude: userLocation?.lat || null,
    longitude: userLocation?.lng || null,
    wifiQuality: 3,
    hasOutlets: false,
    noiseLevel: "moderate",
    description: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isSignedIn) {
      setError("Please sign in to suggest a venue");
      return;
    }

    if (!formData.name.trim()) {
      setError("Venue name is required");
      return;
    }

    if (!formData.latitude || !formData.longitude) {
      setError("Location coordinates are required. Click 'Use My Location' or enter manually.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const placeId = `crowdsourced_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const response = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeId,
          name: formData.name,
          address: formData.address,
          category: formData.category,
          latitude: formData.latitude,
          longitude: formData.longitude,
          wifiQuality: formData.wifiQuality,
          hasOutlets: formData.hasOutlets,
          noiseLevel: formData.noiseLevel,
          crowdsourced: true,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to submit venue");
      }

      setSuccess(true);
      onSubmitSuccess?.();

      setTimeout(() => {
        setSuccess(false);
        onClose();
        setFormData({
          name: "",
          address: "",
          category: "cafe",
          latitude: userLocation?.lat || null,
          longitude: userLocation?.lng || null,
          wifiQuality: 3,
          hasOutlets: false,
          noiseLevel: "moderate",
          description: "",
        });
      }, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit venue");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseMyLocation = () => {
    if (userLocation) {
      setFormData(prev => ({
        ...prev,
        latitude: userLocation.lat,
        longitude: userLocation.lng,
      }));
    } else if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormData(prev => ({
            ...prev,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }));
        },
        () => setError("Could not get your location")
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop - High Contrast Solid for Visibility */}
      <div
        className="absolute inset-0 bg-black/95"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white dark:bg-zinc-950 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-black uppercase tracking-tighter text-zinc-900 dark:text-zinc-50">
            Suggest a Workspace
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {success && (
            <div className="p-3 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg text-sm font-bold">
              ✅ Venue submitted successfully!
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-lg text-sm font-bold border border-red-500/20">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
              Venue Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Blue Bottle Coffee"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
              Category *
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as VenueFormData["category"] }))}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="cafe">☕ Cafe</option>
              <option value="coworking">🏢 Coworking Space</option>
              <option value="library">📚 Library</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
              Location *
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                value={formData.latitude || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, latitude: parseFloat(e.target.value) || null }))}
                placeholder="Lat"
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 text-sm"
              />
              <input
                type="number"
                step="any"
                value={formData.longitude || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, longitude: parseFloat(e.target.value) || null }))}
                placeholder="Lng"
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 text-sm"
              />
              <button
                type="button"
                onClick={handleUseMyLocation}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-md transition-all active:scale-95"
              >
                <MapPin className="w-5 h-5" />
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !isSignedIn}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest rounded-lg disabled:opacity-50 transition-all shadow-lg glow-blue active:scale-[0.98]"
          >
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Submit Venue"}
          </button>
        </form>
      </div>
    </div>
  );
}
