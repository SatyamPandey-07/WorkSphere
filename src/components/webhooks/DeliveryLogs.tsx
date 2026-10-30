"use client";

import { getWebhookLogs } from "@/app/dashboard/webhooks/actions";
import { cn } from "@/lib/utils";
import { WebhookEndpoint, WebhookDeliveryLog } from "@prisma/client";
import { useEffect, useState } from "react";

export interface DeliveryLogsProps {
  endpoints?: WebhookEndpoint[] | null;
  initialSelectedEndpointId?: string;
  className?: string;
  onEndpointChange?: (endpointId: string) => void;
  onLogsLoaded?: (logs: WebhookDeliveryLog[]) => void;
}

export function DeliveryLogs({
  endpoints,
  initialSelectedEndpointId,
  className,
  onEndpointChange,
  onLogsLoaded,
}: DeliveryLogsProps) {
  const safeEndpoints = endpoints ?? [];
  const defaultEndpointId =
    initialSelectedEndpointId &&
    safeEndpoints.some((ep) => ep.id === initialSelectedEndpointId)
      ? initialSelectedEndpointId
      : (safeEndpoints[0]?.id || "");

  const [logs, setLogs] = useState<WebhookDeliveryLog[]>([]);
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>(defaultEndpointId);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (
      selectedEndpoint &&
      !safeEndpoints.some((ep) => ep.id === selectedEndpoint)
    ) {
      const nextId = safeEndpoints[0]?.id || "";
      setSelectedEndpoint(nextId);
      onEndpointChange?.(nextId);
    } else if (!selectedEndpoint && safeEndpoints.length > 0) {
      const nextId = safeEndpoints[0]?.id || "";
      setSelectedEndpoint(nextId);
      onEndpointChange?.(nextId);
    }
  }, [safeEndpoints, selectedEndpoint, onEndpointChange]);

  useEffect(() => {
    let isSubscribed = true;

    if (selectedEndpoint) {
      setIsLoading(true);
      getWebhookLogs(selectedEndpoint)
        .then((data) => {
          if (!isSubscribed) return;
          const safeLogs = Array.isArray(data) ? data : [];
          setLogs(safeLogs);
          setIsLoading(false);
          onLogsLoaded?.(safeLogs);
        })
        .catch(() => {
          if (!isSubscribed) return;
          setLogs([]);
          setIsLoading(false);
          onLogsLoaded?.([]);
        });
    } else {
      setLogs([]);
      setIsLoading(false);
    }

    return () => {
      isSubscribed = false;
    };
  }, [selectedEndpoint, onLogsLoaded]);

  const handleEndpointSelect = (endpointId: string) => {
    setSelectedEndpoint(endpointId);
    onEndpointChange?.(endpointId);
  };

  if (safeEndpoints.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="delivery-logs-container"
      className={cn("space-y-4", className)}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Delivery Logs
        </h3>
        <select
          data-testid="delivery-logs-endpoint-select"
          value={selectedEndpoint}
          onChange={(e) => handleEndpointSelect(e.target.value)}
          className="bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-md text-sm text-zinc-800 dark:text-zinc-200 px-3 py-1.5 focus:ring-primary focus:border-primary"
        >
          {safeEndpoints.map((ep) => (
            <option
              key={ep.id}
              value={ep.id}
              data-testid={`delivery-logs-option-${ep.id}`}
            >
              {ep.url}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table
            data-testid="delivery-logs-table"
            className="w-full text-sm text-left"
          >
            <thead className="bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">Event Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={4}
                    data-testid="delivery-logs-loading"
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    Loading delivery logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    data-testid="delivery-logs-empty"
                    className="px-4 py-8 text-center text-zinc-500"
                  >
                    No delivery logs found for this endpoint.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    data-testid={`delivery-log-row-${log.id}`}
                    className="border-t border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
                  >
                    <td
                      data-testid={`delivery-log-event-${log.id}`}
                      className="px-4 py-3 font-medium"
                    >
                      {log.eventType}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        data-testid={`delivery-log-status-${log.id}`}
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          log.status === "SUCCESS" ||
                          log.status === "DISPATCHED_TO_SVIX"
                            ? "bg-green-500/20 text-green-400"
                            : log.status === "SKIPPED_OUTSIDE_WINDOW"
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td
                      data-testid={`delivery-log-code-${log.id}`}
                      className="px-4 py-3 font-mono"
                    >
                      {log.statusCode || "-"}
                    </td>
                    <td
                      data-testid={`delivery-log-time-${log.id}`}
                      className="px-4 py-3 text-zinc-500"
                    >
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
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

export default DeliveryLogs;
