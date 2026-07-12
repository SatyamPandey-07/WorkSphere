"use client";

import { useState } from "react";
import {
  sendTestSlackNotification,
  updateSlackSettings,
} from "@/app/dashboard/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialWebhookUrl: string;
  initialEnabled: boolean;
};

export function SlackIntegrationForm({
  initialWebhookUrl,
  initialEnabled,
}: Props) {
  const [webhookUrl, setWebhookUrl] = useState(initialWebhookUrl);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      await updateSlackSettings({
        slackWebhookUrl: webhookUrl,
        slackNotifyEnabled: enabled,
      });
      setMessage({ type: "success", text: "Slack settings saved." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save settings",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);

    try {
      await sendTestSlackNotification();
      setMessage({ type: "success", text: "Test message sent to Slack." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to send test message",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 bg-zinc-900/50 p-6 rounded-lg border border-zinc-800"
    >
      <div>
        <h3 className="text-lg font-semibold text-zinc-100">
          Slack Notifications
        </h3>
        <p className="mt-1 text-sm text-zinc-400">
          Get a Slack message whenever you reserve a workspace, so coworkers
          following your channel know where to find you.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="slack-webhook-url">Slack Webhook URL</Label>
        <Input
          id="slack-webhook-url"
          type="url"
          placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          className="bg-zinc-950 border-zinc-800 text-zinc-100"
        />
        <p className="text-xs text-zinc-500">
          Create one from your Slack workspace under Apps → Incoming
          Webhooks.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-zinc-700 bg-zinc-900 text-primary focus:ring-primary"
        />
        Notify on reservation
      </label>

      {message && (
        <p
          className={`text-sm ${
            message.type === "success" ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={testing || !webhookUrl}
          onClick={handleTest}
        >
          {testing ? "Sending..." : "Send test message"}
        </Button>
      </div>
    </form>
  );
}