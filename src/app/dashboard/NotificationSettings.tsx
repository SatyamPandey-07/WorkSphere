"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import {
  Bell,
  ShieldAlert,
  Check,
  Loader2,
  MessageCircle,
  Camera,
  User,
  X,
} from "lucide-react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";

const getCroppedImg = async (
  imageSrc: string,
  pixelCrop: Area,
): Promise<Blob> => {
  const image = new window.Image();
  image.src = imageSrc;
  await new Promise((resolve) => (image.onload = resolve));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d context");

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);

  const croppedCanvas = document.createElement("canvas");
  const croppedCtx = croppedCanvas.getContext("2d");
  if (!croppedCtx) throw new Error("No 2d context");

  croppedCanvas.width = pixelCrop.width;
  croppedCanvas.height = pixelCrop.height;

  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );

  return new Promise((resolve, reject) => {
    croppedCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas is empty"));
    }, "image/jpeg");
  });
};

export function NotificationSettings() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [smsAlertsEnabled, setSmsAlertsEnabled] = useState(false);
  const [whatsappWebhookUrl, setWhatsappWebhookUrl] = useState("");
  const [notificationStart, setNotificationStart] = useState("");
  const [notificationEnd, setNotificationEnd] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );
  const [imageUrl, setImageUrl] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const timezones =
    typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [
          "UTC",
          "America/New_York",
          "America/Chicago",
          "America/Denver",
          "America/Los_Angeles",
          "America/Anchorage",
          "Pacific/Honolulu",
          "Europe/London",
          "Europe/Paris",
          "Europe/Berlin",
          "Asia/Tokyo",
          "Asia/Shanghai",
          "Asia/Kolkata",
          "Australia/Sydney",
        ];

  useEffect(() => {
    async function fetchSettings() {
      try {
        const res = await fetch("/api/user/settings");
        if (res.ok) {
          const data = await res.json();
          setPhoneNumber(data.phoneNumber || "");
          setSmsAlertsEnabled(data.smsAlertsEnabled || false);
          setWhatsappWebhookUrl(data.whatsappWebhookUrl || "");
          setNotificationStart(data.notificationStart || "");
          setNotificationEnd(data.notificationEnd || "");
          setImageUrl(data.imageUrl || "");
          setTimezone(
            data.timezone ||
              (typeof Intl !== "undefined"
                ? Intl.DateTimeFormat().resolvedOptions().timeZone
                : "UTC"),
          );
        }
      } catch (err) {
        console.error("Failed to load notification settings:", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveStatus("idle");

    try {
      const res = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber,
          smsAlertsEnabled,
          whatsappWebhookUrl,
          notificationStart: notificationStart || null,
          notificationEnd: notificationEnd || null,
          timezone,
        }),
      });

      if (res.ok) {
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        setCropImageSrc(reader.result?.toString() || null);
      });
      reader.readAsDataURL(file);
      e.target.value = "";
    }
  };

  const handleSaveAvatar = async () => {
    if (!cropImageSrc || !croppedAreaPixels) return;
    setUploadingAvatar(true);
    setSaveStatus("idle");
    try {
      const croppedBlob = await getCroppedImg(cropImageSrc, croppedAreaPixels);
      const formData = new FormData();
      formData.append("file", croppedBlob, "avatar.jpg");

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const { url } = await uploadRes.json();

      const saveRes = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: url }),
      });
      if (!saveRes.ok) throw new Error("Save profile failed");

      setImageUrl(url);
      setCropImageSrc(null);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      console.error("Avatar upload error:", err);
      setSaveStatus("error");
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 flex justify-center items-center h-48">
        <Loader2 className="w-6 h-6 animate-spin accent-text" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 accent-text" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 font-sans">
          Notification Settings
        </h2>
      </div>

      <div className="mb-8 flex flex-col sm:flex-row items-center gap-6 p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="relative w-20 h-20 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700 flex-shrink-0">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt="Avatar"
              width={80}
              height={80}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-400">
              <User className="w-8 h-8" />
            </div>
          )}
          {uploadingAvatar && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          )}
        </div>
        <div className="flex flex-col items-center sm:items-start gap-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Profile Avatar
          </h3>
          <p className="text-xs text-zinc-500 mb-1 text-center sm:text-left">
            Upload a square image to display on your profile and bookings.
          </p>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={onFileChange}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploadingAvatar}
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-50 text-xs font-semibold rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            Change Avatar
          </button>
        </div>
      </div>

      {cropImageSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                Crop Avatar
              </h3>
              <button
                onClick={() => setCropImageSrc(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="relative h-64 w-full bg-black/10 dark:bg-black/40">
              <Cropper
                image={cropImageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_croppedArea: Area, croppedAreaPixels: Area) =>
                  setCroppedAreaPixels(croppedAreaPixels)
                }
              />
            </div>
            <div className="p-4 flex justify-end gap-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                onClick={() => setCropImageSrc(null)}
                className="px-4 py-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAvatar}
                disabled={uploadingAvatar}
                className="px-4 py-2 accent-bg accent-bg-hover text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {uploadingAvatar ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Save Avatar
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Phone number */}
        <div>
          <label
            htmlFor="phone-number"
            className="block text-xs font-black uppercase tracking-widest text-zinc-500 mb-2"
          >
            Phone Number
          </label>
          <input
            id="phone-number"
            type="tel"
            placeholder="+1234567890"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] focus:border-[var(--primary-accent)] font-mono text-sm transition-all"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            Used for WhatsApp booking confirmations and SMS reminders (E.164
            format).
          </p>
        </div>

        {/* WhatsApp webhook URL */}
        <div>
          <label
            htmlFor="whatsapp-webhook-url"
            className="block text-xs font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5"
          >
            <MessageCircle className="w-3.5 h-3.5 text-green-500" />
            WhatsApp Webhook URL
          </label>
          <input
            id="whatsapp-webhook-url"
            type="url"
            placeholder="https://hooks.make.com/... or https://hooks.zapier.com/..."
            value={whatsappWebhookUrl}
            onChange={(e) => setWhatsappWebhookUrl(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 font-mono text-sm transition-all"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            Optional. Paste a Make, Zapier, or custom HTTPS webhook to stream
            booking check-ins to a WhatsApp group. WorkSphere will POST venue
            details and a location pin automatically when a booking is
            confirmed.
          </p>
        </div>

        {/* Daily Time Window */}
        <div className="p-4 bg-zinc-50 dark:bg-zinc-800/40 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Daily Notification Window
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
                Allowed Start Time
              </label>
              <input
                type="time"
                value={notificationStart}
                onChange={(e) => setNotificationStart(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] focus:border-[var(--primary-accent)] text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
                Allowed End Time
              </label>
              <input
                type="time"
                value={notificationEnd}
                onChange={(e) => setNotificationEnd(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] focus:border-[var(--primary-accent)] text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
                Your Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] focus:border-[var(--primary-accent)] text-sm transition-all"
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Specify the start and end of the daily window during which reminders
            and webhooks can be sent. Leave blank to receive alerts at any time.
          </p>
        </div>

        {/* SMS opt-in */}
        <div className="flex items-start gap-3">
          <input
            id="sms-alerts"
            type="checkbox"
            checked={smsAlertsEnabled}
            onChange={(e) => setSmsAlertsEnabled(e.target.checked)}
            className="w-4 h-4 mt-1 border-zinc-300 dark:border-zinc-700 rounded focus:ring-[var(--primary-accent)]"
          />
          <label
            htmlFor="sms-alerts"
            className="text-sm text-zinc-700 dark:text-zinc-300 select-none"
          >
            <span className="font-semibold block">Opt-in to SMS reminders</span>
            <span className="text-xs text-zinc-500 block mt-0.5">
              Receive text alerts for collaborative sessions starting within 30
              minutes.
            </span>
          </label>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 accent-bg accent-bg-hover text-white text-sm font-semibold rounded-xl disabled:opacity-50 flex items-center gap-2 transition-colors active:scale-[0.98]"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </button>

          {saveStatus === "success" && (
            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm font-medium">
              <Check className="w-4 h-4" />
              Settings saved successfully!
            </div>
          )}

          {saveStatus === "error" && (
            <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400 text-sm font-medium">
              <ShieldAlert className="w-4 h-4" />
              Failed to save settings.
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
