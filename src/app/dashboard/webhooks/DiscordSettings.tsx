'use client';

import { useState } from 'react';
import { saveDiscordWebhookUrl } from '@/app/dashboard/webhooks/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function DiscordSettings({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    try {
      await saveDiscordWebhookUrl(url);
      setSaved(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save Discord webhook');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-zinc-900/50 p-6 rounded-lg border border-zinc-800">
      <div>
        <h3 className="text-lg font-semibold text-zinc-100">Discord Notifications</h3>
        <p className="text-sm text-zinc-400 mt-1">
          Get a message in your Discord channel whenever you book a workspace.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="discord-url">Discord Webhook URL</Label>
        <Input
          id="discord-url"
          type="url"
          placeholder="https://discord.com/api/webhooks/..."
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
          className="bg-zinc-950 border-zinc-800 text-zinc-100"
        />
        <p className="text-xs text-zinc-500">
          In Discord: Channel Settings → Integrations → Webhooks → New Webhook → Copy URL.
        </p>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
      </Button>
    </form>
  );
}