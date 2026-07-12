"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { isValidSlackWebhookUrl } from "@/lib/notifications/slack";

export async function getSlackSettings() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { slackWebhookUrl: true, slackNotifyEnabled: true },
  });

  return {
    slackWebhookUrl: user?.slackWebhookUrl ?? "",
    slackNotifyEnabled: user?.slackNotifyEnabled ?? true,
  };
}

export async function updateSlackSettings(data: {
  slackWebhookUrl: string;
  slackNotifyEnabled: boolean;
}) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const url = data.slackWebhookUrl.trim();

  if (url && !isValidSlackWebhookUrl(url)) {
    throw new Error(
      "That doesn't look like a Slack Incoming Webhook URL. It should start with https://hooks.slack.com/services/",
    );
  }

  await ensureUserExists(userId);

  await prisma.user.update({
    where: { id: userId },
    data: {
      slackWebhookUrl: url || null,
      slackNotifyEnabled: data.slackNotifyEnabled,
    },
  });

  revalidatePath("/dashboard/settings");
}

export async function sendTestSlackNotification() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { slackWebhookUrl: true },
  });

  if (!user?.slackWebhookUrl) {
    throw new Error("Add a Slack webhook URL first.");
  }

  if (!isValidSlackWebhookUrl(user.slackWebhookUrl)) {
    throw new Error("Saved webhook URL doesn't look valid.");
  }

  const response = await fetch(user.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":white_check_mark: *WorkSphere test notification* — your Slack integration is working!",
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack responded with status ${response.status}`);
  }
}