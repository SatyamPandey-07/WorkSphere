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
      const response = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      
      // Reset form after success
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white dark:bg-zinc-900 rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
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
          {/* Success Message */}
          {success && (
            <div className="p-3 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg text-sm">
              ✅ Venue submitted successfully! Thank you for contributing.
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Venue Name */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Venue Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Blue Bottle Coffee"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Address
            </label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
              placeholder="e.g., 123 Main St, San Francisco"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Category *
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as VenueFormData["category"] }))}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="cafe">☕ Cafe</option>
              <option value="coworking">🏢 Coworking Space</option>
              <option value="library">📚 Library</option>
            </select>
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Location *
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                step="any"
                value={formData.latitude || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, latitude: parseFloat(e.target.value) || null }))}
                placeholder="Latitude"
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
              <input
                type="number"
                step="any"
                value={formData.longitude || ""}
                onChange={(e) => setFormData(prev => ({ ...prev, longitude: parseFloat(e.target.value) || null }))}
                placeholder="Longitude"
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
              <button
                type="button"
                onClick={handleUseMyLocation}
                className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
              >
                <MapPin className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* WiFi Quality */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Wifi className="w-4 h-4 text-blue-600" />
              WiFi Quality
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, wifiQuality: n }))}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                    formData.wifiQuality === n
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Has Outlets */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Zap className="w-4 h-4 text-yellow-600" />
              Power Outlets
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, hasOutlets: true }))}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  formData.hasOutlets
                    ? "bg-green-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                Yes, plenty
              </button>
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, hasOutlets: false }))}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  !formData.hasOutlets
                    ? "bg-red-600 text-white"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                No / Limited
              </button>
            </div>
          </div>

          {/* Noise Level */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              <Volume2 className="w-4 h-4 text-purple-600" />
              Noise Level
            </label>
            <div className="flex gap-2">
              {(["quiet", "moderate", "loud"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, noiseLevel: level }))}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg capitalize transition-colors ${
                    formData.noiseLevel === level
                      ? level === "quiet"
                        ? "bg-green-600 text-white"
                        : level === "moderate"
                        ? "bg-yellow-600 text-white"
                        : "bg-red-600 text-white"
                      : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !isSignedIn}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit Venue
              </>
            )}
          </button>

          {!isSignedIn && (
            <p className="text-center text-sm text-zinc-500">
              Please sign in to suggest a venue
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
