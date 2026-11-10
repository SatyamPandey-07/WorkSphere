"use client";

import {
  deleteWebhookEndpoint,
  sendTestWebhook,
  setWebhookEndpointActive,
} from "@/app/dashboard/webhooks/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { WebhookEndpoint } from "@prisma/client";
import {
  Trash2,
  Copy,
  CheckCircle2,
  Send,
  Pause,
  Play,
  Loader2,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export type TestState =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "done"; ok: boolean; message: string };

export interface WebhookListProps {
  endpoints?: WebhookEndpoint[] | null;
  className?: string;
  onEndpointDeleted?: (id: string) => void;
  onEndpointToggled?: (id: string, active: boolean) => void;
  onTestSent?: (id: string, result: unknown) => void;
}

export function WebhookList({
  endpoints,
  className,
  onEndpointDeleted,
  onEndpointToggled,
  onTestSent,
}: WebhookListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const copyTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleDelete = async (id: string) => {
    const confirmed =
      typeof window !== "undefined" && typeof window.confirm === "function"
        ? window.confirm("Delete this webhook? Deliveries to it will stop immediately.")
        : true;
    if (confirmed) {
      await deleteWebhookEndpoint(id);
      onEndpointDeleted?.(id);
    }
  };

  const handleCopy = (secret: string, id: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(secret).catch(() => {
          // Ignore clipboard write failures in test or restricted context
        });
      }
    } catch {
      // Ignore clipboard sync access error
    }
    setCopiedId(id);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTest = async (id: string) => {
    setTests((prev) => ({ ...prev, [id]: { state: "sending" } }));
    const result = await sendTestWebhook(id);
    const testState: TestState = result.ok
      ? {
          state: "done",
          ok: result.status === "SUCCESS",
          message:
            result.status === "SUCCESS"
              ? `Delivered (HTTP ${result.statusCode})`
              : result.status === "BLOCKED"
                ? "Blocked: URL resolves to a private network"
                : `Failed${result.statusCode ? ` (HTTP ${result.statusCode})` : " (no response)"}`,
        }
      : { state: "done", ok: false, message: result.error };

    setTests((prev) => ({
      ...prev,
      [id]: testState,
    }));
    onTestSent?.(id, result);
  };

  const handleToggle = async (endpoint: WebhookEndpoint) => {
    setBusyId(endpoint.id);
    const nextActive = !endpoint.isActive;
    await setWebhookEndpointActive(endpoint.id, nextActive);
    onEndpointToggled?.(endpoint.id, nextActive);
    setBusyId(null);
  };

  const safeEndpoints = endpoints ?? [];

  if (safeEndpoints.length === 0) {
    return (
      <div
        data-testid="webhook-list-empty"
        className={cn(
          "text-zinc-500 py-8 text-center bg-white/30 dark:bg-zinc-900/30 rounded-lg",
          className
        )}
      >
        No webhooks configured yet.
      </div>
    );
  }

  return (
    <div
      data-testid="webhook-list"
      className={cn("space-y-4", className)}
    >
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Configured Endpoints
      </h3>
      <p className="text-xs text-zinc-500">
        Each delivery is signed with the endpoint secret using the Standard
        Webhooks scheme (<code>webhook-id</code>, <code>webhook-timestamp</code>
        , <code>webhook-signature</code> headers), so any Svix /
        standard-webhooks library can verify it.
      </p>
      {safeEndpoints.map((endpoint) => {
        const test = tests[endpoint.id] ?? { state: "idle" };
        const eventTypes = endpoint.eventTypes ?? [];
        return (
          <div
            key={endpoint.id}
            data-testid={`webhook-item-${endpoint.id}`}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-lg flex flex-col sm:flex-row justify-between gap-4"
          >
            <div className="space-y-2 min-w-0">
              <div className="flex items-center space-x-2 text-sm text-zinc-600 dark:text-zinc-400">
                <span
                  data-testid={`webhook-status-indicator-${endpoint.id}`}
                  className={`w-2 h-2 shrink-0 rounded-full ${endpoint.isActive ? "bg-green-500" : "bg-zinc-500"}`}
                  aria-label={endpoint.isActive ? "Active" : "Paused"}
                />
                <span
                  data-testid={`webhook-url-${endpoint.id}`}
                  className="font-mono text-zinc-800 dark:text-zinc-200 break-all"
                >
                  {endpoint.url}
                </span>
              </div>

              <div className="flex items-center space-x-2 text-xs text-zinc-500">
                <span className="font-semibold">Secret:</span>
                <span
                  data-testid={`webhook-secret-${endpoint.id}`}
                  className="font-mono bg-zinc-50 dark:bg-zinc-950 px-2 py-1 rounded truncate max-w-[200px]"
                >
                  {endpoint.secret}
                </span>
                <button
                  type="button"
                  data-testid={`webhook-copy-btn-${endpoint.id}`}
                  onClick={() => handleCopy(endpoint.secret, endpoint.id)}
                  className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  title="Copy secret"
                  aria-label="Copy secret"
                >
                  {copiedId === endpoint.id ? (
                    <CheckCircle2
                      data-testid={`webhook-copied-icon-${endpoint.id}`}
                      className="w-4 h-4 text-green-500"
                    />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div
                data-testid={`webhook-events-${endpoint.id}`}
                className="flex flex-wrap gap-2 pt-2"
              >
                {eventTypes.map((type) => (
                  <span
                    key={type}
                    data-testid={`webhook-event-tag-${endpoint.id}-${type}`}
                    className="text-[10px] uppercase bg-primary/10 text-primary px-2 py-1 rounded-full font-semibold tracking-wide"
                  >
                    {type.replace(/_/g, " ")}
                  </span>
                ))}
              </div>

              {test.state === "done" && (
                <p
                  role="status"
                  data-testid={`webhook-test-status-${endpoint.id}`}
                  className={`text-xs ${test.ok ? "text-green-400" : "text-red-400"}`}
                >
                  {test.message}
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                data-testid={`webhook-test-btn-${endpoint.id}`}
                onClick={() => handleTest(endpoint.id)}
                disabled={test.state === "sending"}
                title="Send a test event"
              >
                {test.state === "sending" ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span className="ml-1">Test</span>
              </Button>
              <Button
                variant="outline"
                size="icon"
                data-testid={`webhook-toggle-btn-${endpoint.id}`}
                onClick={() => handleToggle(endpoint)}
                disabled={busyId === endpoint.id}
                title={
                  endpoint.isActive ? "Pause deliveries" : "Resume deliveries"
                }
                aria-label={
                  endpoint.isActive ? "Pause deliveries" : "Resume deliveries"
                }
              >
                {endpoint.isActive ? (
                  <Pause className="w-4 h-4" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                data-testid={`webhook-delete-btn-${endpoint.id}`}
                onClick={() => handleDelete(endpoint.id)}
                aria-label="Delete webhook"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default WebhookList;
