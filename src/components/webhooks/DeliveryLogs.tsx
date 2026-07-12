'use client';

import { getWebhookLogs } from '@/app/dashboard/webhooks/actions';
import { WebhookEndpoint, WebhookDeliveryLog } from '@prisma/client';
import { useEffect, useState } from 'react';

export function DeliveryLogs({ endpoints }: { endpoints: WebhookEndpoint[] }) {
  const [logs, setLogs] = useState<WebhookDeliveryLog[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>(endpoints[0]?.id || '');

  useEffect(() => {
    if (selectedEndpoint) {
      getWebhookLogs(selectedEndpoint).then(setLogs);
    }
  }, [selectedEndpoint]);

  if (endpoints.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">Delivery Logs</h3>
        <select 
          value={selectedEndpoint} 
          onChange={(e) => setSelectedEndpoint(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded-md text-sm text-zinc-200 px-3 py-1.5 focus:ring-primary focus:border-primary"
        >
          {endpoints.map(ep => (
            <option key={ep.id} value={ep.id}>{ep.url}</option>
          ))}
        </select>
      </div>

      <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-zinc-900 text-zinc-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Event Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                    No delivery logs found for this endpoint.
                  </td>
                </tr>
              ) : (
                logs.map(log => (
                  <tr key={log.id} className="border-t border-zinc-800 text-zinc-300">
                    <td className="px-4 py-3 font-medium">{log.eventType}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        log.status === 'SUCCESS' || log.status === 'DISPATCHED_TO_SVIX' 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono">{log.statusCode || '-'}</td>
                    <td className="px-4 py-3 text-zinc-500">{new Date(log.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
