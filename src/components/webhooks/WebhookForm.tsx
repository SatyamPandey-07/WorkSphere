"use client";

import React, { useState, useEffect, useRef } from "react";
import { createWebhookEndpoint } from "@/app/dashboard/webhooks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const EVENT_TYPES: { value: string; label: string }[] = [
  { value: "BOOKING_CONFIRMED", label: "Booking confirmed" },
  { value: "BOOKING_CANCELLED", label: "Booking cancelled" },
  { value: "BOOKING_RESCHEDULED", label: "Booking rescheduled" },
  { value: "VENUE_CREATED", label: "Venue added" },
  { value: "REVIEW_SUBMITTED", label: "Review submitted" },
  { value: "AI_WORKFLOW_COMPLETED", label: "AI search completed" },
  { value: "MAP_GEOFENCE_BREACHED", label: "Arrived at venue" },
  { value: "DOCUMENT_SIGNED", label: "Document signed" },
];

export interface WebhookEndpointResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export interface WebhookFormProps {
  className?: string;
  onSuccess?: () => void;
  onError?: (err: string) => void;
  onCreateEndpoint?: (params: {
    url: string;
    eventTypes: string[];
    headers: Record<string, string>;
  }) => Promise<{ ok: boolean; error?: string }>;
}

export function WebhookForm({
  className,
  onSuccess,
  onError,
  onCreateEndpoint = createWebhookEndpoint,
}: WebhookFormProps = {}) {
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [headersList, setHeadersList] = useState<
    { key: string; value: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  };

  const addHeader = (e: React.MouseEvent) => {
    e.preventDefault();
    setHeadersList((prev) => [...prev, { key: "", value: "" }]);
  };

  const removeHeader = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setHeadersList((prev) => prev.filter((_, i) => i !== index));
  };

  const updateHeader = (
    index: number,
    field: "key" | "value",
    value: string,
  ) => {
    setHeadersList((prev) =>
      prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const formattedHeaders = headersList
        .filter((h) => h.key.trim() && h.value.trim())
        .reduce(
          (acc, curr) => ({ ...acc, [curr.key.trim()]: curr.value.trim() }),
          {},
        );

      const result = await onCreateEndpoint({
        url,
        eventTypes: selectedEvents,
        headers: formattedHeaders,
      });

      if (!isMountedRef.current) return;

      if (!result.ok) {
        const errorMsg = result.error || "Could not create the webhook.";
        setError(errorMsg);
        onError?.(errorMsg);
        return;
      }

      setUrl("");
      setSelectedEvents([]);
      setHeadersList([]);
      onSuccess?.();
    } catch (err) {
      console.error(err);
      if (!isMountedRef.current) return;
      const errorMsg = "Could not create the webhook. Please try again.";
      setError(errorMsg);
      onError?.(errorMsg);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  return (
    <form
      data-testid="webhook-form"
      onSubmit={handleSubmit}
      className={cn(
        "space-y-4 bg-white/50 dark:bg-zinc-900/50 p-6 rounded-lg border border-zinc-200 dark:border-zinc-800",
        className,
      )}
    >
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Add New Webhook
      </h3>

      <div className="space-y-2">
        <Label htmlFor="url">Payload URL</Label>
        <Input
          id="url"
          data-testid="webhook-url-input"
          type="url"
          required
          placeholder="https://your-domain.com/webhook"
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setUrl(e.target.value)
          }
          className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
        />
      </div>

      {/* Custom Headers Config Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Custom Headers</Label>
          <button
            type="button"
            data-testid="webhook-add-header-btn"
            onClick={addHeader}
            className="text-xs text-primary hover:underline focus:outline-none"
          >
            + Add Header
          </button>
        </div>

        {headersList.length > 0 && (
          <div className="space-y-2" data-testid="webhook-headers-list">
            {headersList.map((header, idx) => (
              <div
                key={`header-${idx}`}
                data-testid={`webhook-header-row-${idx}`}
                className="flex items-center gap-2"
              >
                <Input
                  type="text"
                  data-testid={`webhook-header-key-${idx}`}
                  placeholder="Key (e.g. Authorization)"
                  value={header.key}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateHeader(idx, "key", e.target.value)
                  }
                  className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs flex-1"
                />
                <Input
                  type="text"
                  data-testid={`webhook-header-value-${idx}`}
                  placeholder="Value"
                  value={header.value}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateHeader(idx, "value", e.target.value)
                  }
                  className="bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-xs flex-1"
                />
                <button
                  type="button"
                  data-testid={`webhook-header-remove-${idx}`}
                  onClick={(e) => removeHeader(e, idx)}
                  className="text-red-500 hover:text-red-400 text-xs px-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Events</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {EVENT_TYPES.map((event) => (
            <label
              key={event.value}
              className="flex items-center space-x-2 text-sm text-zinc-700 dark:text-zinc-300"
            >
              <input
                type="checkbox"
                data-testid={`webhook-event-checkbox-${event.value}`}
                checked={selectedEvents.includes(event.value)}
                onChange={() => toggleEvent(event.value)}
                className="rounded border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-primary focus:ring-primary"
              />
              <span>{event.label}</span>
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          data-testid="webhook-error-alert"
          className="text-sm text-red-400"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        data-testid="webhook-submit-btn"
        disabled={loading || selectedEvents.length === 0 || !url}
      >
        {loading ? "Creating..." : "Create Webhook"}
      </Button>
    </form>
  );
}

export default WebhookForm;
