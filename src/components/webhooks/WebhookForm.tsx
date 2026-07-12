'use client';

import { useState } from 'react';
import { createWebhookEndpoint } from '@/app/dashboard/webhooks/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const EVENT_TYPES = [
  'DOCUMENT_SIGNED',
  'AI_WORKFLOW_COMPLETED',
  'MAP_GEOFENCE_BREACHED',
  'VENUE_CREATED',
  'REVIEW_SUBMITTED'
];

export function WebhookForm() {
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleEvent = (event: string) => {
    setSelectedEvents(prev => 
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await createWebhookEndpoint({ url, eventTypes: selectedEvents });
      setUrl('');
      setSelectedEvents([]);
    } catch (error) {
      console.error(error);
      alert('Failed to create webhook');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 bg-zinc-900/50 p-6 rounded-lg border border-zinc-800">
      <h3 className="text-lg font-semibold text-zinc-100">Add New Webhook</h3>
      
      <div className="space-y-2">
        <Label htmlFor="url">Payload URL</Label>
        <Input 
          id="url"
          type="url"
          required
          placeholder="https://your-domain.com/webhook"
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          className="bg-zinc-950 border-zinc-800 text-zinc-100"
        />
      </div>

      <div className="space-y-2">
        <Label>Events</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EVENT_TYPES.map(event => (
            <label key={event} className="flex items-center space-x-2 text-sm text-zinc-300">
              <input 
                type="checkbox"
                checked={selectedEvents.includes(event)}
                onChange={() => toggleEvent(event)}
                className="rounded border-zinc-700 bg-zinc-900 text-primary focus:ring-primary"
              />
              <span>{event}</span>
            </label>
          ))}
        </div>
      </div>

      <Button type="submit" disabled={loading || selectedEvents.length === 0 || !url}>
        {loading ? 'Creating...' : 'Create Webhook'}
      </Button>
    </form>
  );
}
