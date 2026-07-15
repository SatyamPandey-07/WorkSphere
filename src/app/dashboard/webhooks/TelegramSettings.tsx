'use client';

import { useState } from 'react';
import { saveTelegramWebhookUrl } from '@/app/dashboard/webhooks/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function TelegramSettings({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaved(false);
    try {
      await saveTelegramWebhookUrl(url);
      setSaved(true);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to save Telegram webhook');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-zinc-900/50 p-6 rounded-lg border border-zinc-800">
      <div>
        <h3 className="text-lg font-semibold text-zinc-100">Telegram Notifications</h3>
        <p className="text-sm text-zinc-400 mt-1">
          Get coworking alerts in your Telegram channel when members book or check in.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="telegram-url">Telegram Webhook URL</Label>
        <Input
          id="telegram-url"
          type="url"
          placeholder="https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat_id>"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
          className="bg-zinc-950 border-zinc-800 text-zinc-100"
        />
        <p className="text-xs text-zinc-500">
          Format: <code>https://api.telegram.org/bot&lt;token&gt;/sendMessage?chat_id=&lt;chat_id&gt;</code>.
        </p>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
      </Button>
    </form>
  );
}
