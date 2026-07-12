'use client';

import { deleteWebhookEndpoint } from '@/app/dashboard/webhooks/actions';
import { Button } from '@/components/ui/button';
import { WebhookEndpoint } from '@prisma/client';
import { Trash2, Copy, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

export function WebhookList({ endpoints }: { endpoints: WebhookEndpoint[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this webhook?')) {
      await deleteWebhookEndpoint(id);
    }
  };

  const handleCopy = (secret: string, id: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (endpoints.length === 0) {
    return <div className="text-zinc-500 py-8 text-center bg-zinc-900/30 rounded-lg">No webhooks configured yet.</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-zinc-100">Configured Endpoints</h3>
      {endpoints.map(endpoint => (
        <div key={endpoint.id} className="bg-zinc-900 border border-zinc-800 p-4 rounded-lg flex flex-col sm:flex-row justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center space-x-2 text-sm text-zinc-400">
              <span className={`w-2 h-2 rounded-full ${endpoint.isActive ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="font-mono text-zinc-200">{endpoint.url}</span>
            </div>
            
            <div className="flex items-center space-x-2 text-xs text-zinc-500">
              <span className="font-semibold">Secret:</span>
              <span className="font-mono bg-zinc-950 px-2 py-1 rounded truncate max-w-[200px]">
                {endpoint.secret}
              </span>
              <button 
                onClick={() => handleCopy(endpoint.secret, endpoint.id)}
                className="text-zinc-400 hover:text-zinc-100 transition-colors"
                title="Copy Secret"
              >
                {copiedId === endpoint.id ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {endpoint.eventTypes.map((type: any) => (
                <span key={type} className="text-[10px] uppercase bg-primary/10 text-primary px-2 py-1 rounded-full font-semibold tracking-wide">
                  {type}
                </span>
              ))}
            </div>
          </div>
          
          <div className="flex items-start">
            <Button variant="destructive" size="icon" onClick={() => handleDelete(endpoint.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
