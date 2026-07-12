/**
 * Posts a Slack Incoming Webhook message when a coworker reserves or checks
 * into a venue (#143). Sends Slack Block Kit blocks with venue name,
 * duration, and a map link.
 *
 * This intentionally does NOT go through the generic WebhookEndpoint / Svix
 * system (src/app/api/webhooks/worker) — that pipeline is for third-party
 * developers subscribing to arbitrary WorkSphere events with HMAC-signed
 * payloads. A Slack Incoming Webhook URL is a single, user-specific,
 * unsigned POST endpoint with a fixed JSON shape, so a small dedicated
 * sender is a better fit than forcing it through the generic dispatcher.
 */

import { prisma } from "@/lib/prisma";

const SLACK_WEBHOOK_URL_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/.+/;

export function isValidSlackWebhookUrl(url: string): boolean {
  return SLACK_WEBHOOK_URL_PATTERN.test(url.trim());
}

type CheckInNotificationInput = {
  userId: string;
  venueName: string;
  venueAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  date: string;
  time: string;
  durationMinutes?: number | null;
};

function formatDuration(durationMinutes?: number | null) {
  if (!durationMinutes) return "Not specified";
  if (durationMinutes < 60) return `${durationMinutes} min`;

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function buildMapLink(
  latitude?: number | null,
  longitude?: number | null,
  venueName?: string,
) {
  if (latitude != null && longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }
  if (venueName) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueName)}`;
  }
  return null;
}

function buildSlackBlocks(input: CheckInNotificationInput) {
  const mapLink = buildMapLink(input.latitude, input.longitude, input.venueName);

  const fields = [
    { type: "mrkdwn", text: `*Venue:*\n${input.venueName}` },
    { type: "mrkdwn", text: `*Duration:*\n${formatDuration(input.durationMinutes)}` },
    { type: "mrkdwn", text: `*Date:*\n${input.date} at ${input.time}` },
  ];

  if (input.venueAddress) {
    fields.push({ type: "mrkdwn", text: `*Address:*\n${input.venueAddress}` });
  }

  const blocks: unknown[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:round_pushpin: *A coworker just reserved a spot at ${input.venueName}*`,
      },
    },
    { type: "section", fields },
  ];

  if (mapLink) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Maps", emoji: true },
          url: mapLink,
        },
      ],
    });
  }

  return blocks;
}

/**
 * Fire-and-forget: looks up the user's Slack webhook URL and posts a
 * notification. Never throws — a failed/misconfigured Slack integration
 * must not break the reservation flow that triggered it.
 */
export async function notifySlackOnReservation(
  input: CheckInNotificationInput,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { slackWebhookUrl: true, slackNotifyEnabled: true },
    });

    if (!user?.slackWebhookUrl || !user.slackNotifyEnabled) return;
    if (!isValidSlackWebhookUrl(user.slackWebhookUrl)) return;

    const response = await fetch(user.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: buildSlackBlocks(input) }),
    });

    if (!response.ok) {
      console.error(
        `[Slack Notify] Webhook responded with ${response.status} for user ${input.userId}`,
      );
    }
  } catch (error) {
    console.error("[Slack Notify] Failed to send notification:", error);
  }
}