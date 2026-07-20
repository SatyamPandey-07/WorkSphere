"use client";

import { useState } from "react";
import { Bell, MessageSquare, Check, ShieldCheck } from "lucide-react";
import { saveDiscordWebhookUrl } from "@/app/dashboard/webhooks/actions";

interface NotificationPanelProps {
  initialSlackUrl?: string | null;
}

export function WorkspaceNotificationPanel({
  initialSlackUrl = "",
}: NotificationPanelProps) {
  const [webhookUrl, setWebhookUrl] = useState(initialSlackUrl || "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");

    try {
      await saveDiscordWebhookUrl(webhookUrl);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setStatus("error");
      setErrorMsg((err as Error).message || "Failed to save webhook configuration.");
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6 border border-white/10 bg-black/40 max-w-xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-100">
            Slack & MS Teams Integration
          </h3>
          <p className="text-xs text-zinc-400">
            Broadcast check-ins to your team channel automatically
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 mt-6">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-2">
            Incoming Webhook URL
          </label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/... or MS Teams Webhook"
            className="w-full px-4 py-2.5 rounded-xl bg-zinc-900/80 border border-white/10 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition-colors"
          />
        </div>

        {status === "error" && (
          <p className="text-xs text-red-400 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
            {errorMsg}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> SSRF Protected Endpoint
          </span>

          <button
            type="submit"
            disabled={status === "saving"}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white transition-all disabled:opacity-50"
          >
            {status === "saving" ? (
              "Saving..."
            ) : status === "saved" ? (
              <>
                <Check className="w-3.5 h-3.5" /> Connected
              </>
            ) : (
              "Save Integration"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}