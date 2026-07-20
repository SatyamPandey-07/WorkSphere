"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { validateWebhookUrl } from "@/lib/security/validateWebhookUrl";

// Dispatch check-in event to configured Slack/Teams webhooks
export async function dispatchCheckInNotification(data: {
  userName: string;
  venueName: string;
  location: string;
  venueUrl: string;
}) {
  const { userId } = await auth();
  if (!userId) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { discordWebhookUrl: true, telegramWebhookUrl: true },
  });

  if (!user) return;

  const textMessage = `🚀 **${data.userName}** checked into **${data.venueName}** (${data.location})! Join them: ${data.venueUrl}`;

  // Send to Slack / Teams format webhook if present
  if (user.discordWebhookUrl) {
    const isValid = await validateWebhookUrl(user.discordWebhookUrl);
    if (isValid.valid) {
      try {
        await fetch(user.discordWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: textMessage,
            // Slack / Teams Card compatible payload
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🚀 *${data.userName}* checked into *${data.venueName}* (${data.location})!\n<${data.venueUrl}|Join them on WorkSphere>`,
                },
              },
            ],
          }),
        });
      } catch (err) {
        console.error("Failed to dispatch webhook notification:", err);
      }
    }
  }
}