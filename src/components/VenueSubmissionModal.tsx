"use client";

import { useState, useRef, useEffect } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { X, MapPin, Loader2 } from "lucide-react";

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
  hasPhoneBooths: boolean;
  hasNoMusic: boolean;
  hasQuietZone: boolean;
  singleOriginBeans: boolean;
  specialtyEspresso: boolean;
  oatAlmondMilk: boolean;
  pourOverAvailable: boolean;
  petsAllowedIndoors: boolean;
  patioOnly: boolean;
  waterBowlsProvided: boolean;
}

export function VenueSubmissionModal({
  isOpen,
  onClose,
  userLocation,
  onSubmitSuccess,
}: VenueSubmissionModalProps) {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();

  // Existing State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");

  // New Drag & Drop State and Ref
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    hasPhoneBooths: false,
    hasNoMusic: false,
    hasQuietZone: false,
    singleOriginBeans: false,
    specialtyEspresso: false,
    oatAlmondMilk: false,
    pourOverAvailable: false,
    petsAllowedIndoors: false,
    patioOnly: false,
    waterBowlsProvided: false,
  });

  // Cleanup memory leak when component unmounts or imagePreview changes
  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

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
      setError(
        "Location coordinates are required. Click 'Use My Location' or enter manually.",
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setUploadStatus("Uploading image...");

    try {
      const token = await getToken();
      let imageUrl = null;
      if (file) {
        const uploadData = new FormData();
        uploadData.append("file", file);

        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: uploadData,
        });

        if (!uploadRes.ok) {
          throw new Error("Failed to upload image");
        }

        const jsonResponse = await uploadRes.json();
        imageUrl = jsonResponse.url;
      }

      setUploadStatus("Validating with AI...");
      const placeId = `crowdsourced_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const response = await fetch("/api/venues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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
          hasPhoneBooths: formData.hasPhoneBooths,
          hasNoMusic: formData.hasNoMusic,
          hasQuietZone: formData.hasQuietZone,
          singleOriginBeans: formData.singleOriginBeans,
          specialtyEspresso: formData.specialtyEspresso,
          oatAlmondMilk: formData.oatAlmondMilk,
          pourOverAvailable: formData.pourOverAvailable,
          petsAllowedIndoors: formData.petsAllowedIndoors,
          patioOnly: formData.patioOnly,
          waterBowlsProvided: formData.waterBowlsProvided,
          crowdsourced: true,
          imageUrl,
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
          hasPhoneBooths: false,
          hasNoMusic: false,
          hasQuietZone: false,
          singleOriginBeans: false,
          specialtyEspresso: false,
          oatAlmondMilk: false,
          pourOverAvailable: false,
          petsAllowedIndoors: false,
          patioOnly: false,
          waterBowlsProvided: false,
        });
        setFile(null);
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImagePreview(null);
        setUploadStatus("");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit venue");
    } finally {
      setIsSubmitting(false);
      setUploadStatus("");
    }
  };

  // Centralized File Validation and Processing
  const processFile = (selected: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    const clearState = () => {
      setFile(null);
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
      setImagePreview(null);
      if (inputRef.current) inputRef.current.value = "";
    };

    if (!allowedTypes.includes(selected.type)) {
      setError("Invalid file type. Please upload a JPEG, PNG, or WEBP.");
      clearState();
      return;
    }

    if (selected.size > 5 * 1024 * 1024) {
      setError("Image must be smaller than 5MB");
      clearState();
      return;
    }

    setError(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setFile(selected);
    setImagePreview(URL.createObjectURL(selected));
  };

  // Dropzone Event Handlers
  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      processFile(selected);
    }
  };

  const handleUseMyLocation = () => {
    if (userLocation) {
      setFormData((prev) => ({
        ...prev,
        latitude: userLocation.lat,
        longitude: userLocation.lng,
      }));
    } else if ("geolocation" in navigator) {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setFormData((prev) => ({
              ...prev,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }));
          },
          () => setError("Could not get your location"),
        );
      } catch (err) {
        console.warn("Geolocation sync error in submission modal:", err);
        setError("Could not get your location");
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop - High Contrast Solid for Visibility */}
      <div className="absolute inset-0 bg-black/95" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white dark:bg-zinc-950 rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden border border-zinc-200 dark:border-zinc-800">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-black uppercase tracking-tighter text-zinc-900 dark:text-zinc-50">
            Suggest a Workspace
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="p-4 space-y-4 max-h-[70vh] overflow-y-auto"
        >
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
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
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
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  category: e.target.value as VenueFormData["category"],
                }))
              }
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
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    latitude: parseFloat(e.target.value) || null,
                  }))
                }
                placeholder="Lat"
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 text-sm"
              />
              <input
                type="number"
                step="any"
                value={formData.longitude || ""}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    longitude: parseFloat(e.target.value) || null,
                  }))
                }
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

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
              Venue Photo (Optional)
            </label>

            {/* Drag & Drop File Zone */}
            <div className="flex flex-col gap-2">
              <div
                className={`relative flex flex-col items-center justify-center w-full p-6 border-2 border-dashed rounded-lg cursor-pointer transition-all ${
                  dragActive
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg, image/png, image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                />

                <div className="text-center pointer-events-none">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300 font-bold">
                    Drag & drop a venue photo here
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    or click to browse (JPEG, PNG, WEBP max 5MB)
                  </p>
                </div>
              </div>

              {imagePreview && (
                <div className="relative w-full h-32 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 mt-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="object-cover w-full h-full"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (imagePreview) {
                        URL.revokeObjectURL(imagePreview);
                      }
                      setImagePreview(null);
                      if (inputRef.current) inputRef.current.value = "";
                    }}
                    className="absolute top-2 right-2 p-1 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <p className="text-[10px] text-zinc-400 mt-2">
              Photos are scanned by AI to verify amenities.
            </p>
          </div>

          <div className="space-y-2 border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">
              Acoustic Amenities
            </label>
            <div className="grid grid-cols-1 gap-2">
              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.hasPhoneBooths}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      hasPhoneBooths: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                Phone Booths Available
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.hasNoMusic}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      hasNoMusic: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                No Background Music
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.hasQuietZone}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      hasQuietZone: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                Strict Silence Zones
              </label>
              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.singleOriginBeans}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      singleOriginBeans: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                ☕ Single-Origin Beans
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.specialtyEspresso}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      specialtyEspresso: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                ⚙️ Specialty Espresso Machine
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.oatAlmondMilk}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      oatAlmondMilk: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                🥛 Oat / Almond Milk Available
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.pourOverAvailable}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      pourOverAvailable: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                🫖 Pour-Over Available
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.petsAllowedIndoors}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      petsAllowedIndoors: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                🐶 Pets Allowed Indoors
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.patioOnly}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      patioOnly: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                🌿 Patio Only (Pets allowed outdoors only)
              </label>

              <label className="flex items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={formData.waterBowlsProvided}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      waterBowlsProvided: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-500"
                />
                💧 Water Bowls Provided for Pets
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !isSignedIn}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest rounded-lg disabled:opacity-50 transition-all shadow-lg glow-blue active:scale-[0.98]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{uploadStatus || "Submitting..."}</span>
              </>
            ) : (
              "Submit Venue"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
