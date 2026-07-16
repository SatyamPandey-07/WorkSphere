"use client";

import { useState, useEffect } from "react";
import { Bell, ShieldAlert, Check, Loader2, MessageCircle } from "lucide-react";

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

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 flex justify-center items-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 font-sans">
          Notification Settings
        </h2>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Phone number */}
        <div>
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">
            Phone Number
          </label>
          <input
            type="tel"
            placeholder="+1234567890"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm transition-all"
          />
          <p className="mt-1.5 text-xs text-zinc-500">
            Used for WhatsApp booking confirmations and SMS reminders (E.164
            format).
          </p>
        </div>

        {/* WhatsApp webhook URL */}
        <div>
          <label className="block text-xs font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5 text-green-500" />
            WhatsApp Webhook URL
          </label>
          <input
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
                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
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
                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
                Your Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm transition-all"
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
            className="w-4 h-4 mt-1 border-zinc-300 dark:border-zinc-700 rounded focus:ring-blue-500"
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
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50 flex items-center gap-2 transition-colors active:scale-[0.98]"
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
