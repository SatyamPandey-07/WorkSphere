"use client";

import {
  deleteWebhookEndpoint,
  sendTestWebhook,
  setWebhookEndpointActive,
} from "@/app/dashboard/webhooks/actions";
import { Button } from "@/components/ui/button";
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
import { useState } from "react";

type TestState =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "done"; ok: boolean; message: string };

export function WebhookList({ endpoints }: { endpoints: WebhookEndpoint[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (
      confirm("Delete this webhook? Deliveries to it will stop immediately.")
    ) {
      await deleteWebhookEndpoint(id);
    }
  };

  const handleCopy = (secret: string, id: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTest = async (id: string) => {
    setTests((prev) => ({ ...prev, [id]: { state: "sending" } }));
    const result = await sendTestWebhook(id);
    setTests((prev) => ({
      ...prev,
      [id]: result.ok
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
        : { state: "done", ok: false, message: result.error },
    }));
  };

  const handleToggle = async (endpoint: WebhookEndpoint) => {
    setBusyId(endpoint.id);
    await setWebhookEndpointActive(endpoint.id, !endpoint.isActive);
    setBusyId(null);
  };

  if (endpoints.length === 0) {
    return (
      <div className="text-zinc-500 py-8 text-center bg-white/30 dark:bg-zinc-900/30 rounded-lg">
        No webhooks configured yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Configured Endpoints
      </h3>
      <p className="text-xs text-zinc-500">
        Each delivery is signed with the endpoint secret using the Standard
        Webhooks scheme (<code>webhook-id</code>, <code>webhook-timestamp</code>
        , <code>webhook-signature</code> headers), so any Svix /
        standard-webhooks library can verify it.
      </p>
      {endpoints.map((endpoint) => {
        const test = tests[endpoint.id] ?? { state: "idle" };
        return (
          <div
            key={endpoint.id}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-lg flex flex-col sm:flex-row justify-between gap-4"
          >
            <div className="space-y-2 min-w-0">
              <div className="flex items-center space-x-2 text-sm text-zinc-600 dark:text-zinc-400">
                <span
                  className={`w-2 h-2 shrink-0 rounded-full ${endpoint.isActive ? "bg-green-500" : "bg-zinc-500"}`}
                  aria-label={endpoint.isActive ? "Active" : "Paused"}
                />
                <span className="font-mono text-zinc-800 dark:text-zinc-200 break-all">
                  {endpoint.url}
                </span>
              </div>

              <div className="flex items-center space-x-2 text-xs text-zinc-500">
                <span className="font-semibold">Secret:</span>
                <span className="font-mono bg-zinc-50 dark:bg-zinc-950 px-2 py-1 rounded truncate max-w-[200px]">
                  {endpoint.secret}
                </span>
                <button
                  onClick={() => handleCopy(endpoint.secret, endpoint.id)}
                  className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                  title="Copy secret"
                  aria-label="Copy secret"
                >
                  {copiedId === endpoint.id ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {endpoint.eventTypes.map((type) => (
                  <span
                    key={type}
                    className="text-[10px] uppercase bg-primary/10 text-primary px-2 py-1 rounded-full font-semibold tracking-wide"
                  >
                    {type.replace(/_/g, " ")}
                  </span>
                ))}
              </div>

              {test.state === "done" && (
                <p
                  role="status"
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
