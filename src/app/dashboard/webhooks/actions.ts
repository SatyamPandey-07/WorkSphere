'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import crypto from 'crypto';
import { isValidDiscordWebhookUrl } from '@/lib/discord';
import { isValidTelegramWebhookUrl } from '@/lib/telegram';
import { ensureUserExists } from '@/lib/auth';
import { isSafeWebhookUrl } from '@/lib/ssrfValidation';

export async function createWebhookEndpoint(data: { url: string, eventTypes: any[] }) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  // Ensure user exists in Prisma
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    // Basic user creation fallback if they don't exist yet
    await prisma.user.create({ data: { id: userId, email: userId + '@example.com' } });
  }

  // Generate a random secret for HMAC
  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64');

  // SSRF Protection
  const safetyCheck = await isSafeWebhookUrl(data.url);
  if (!safetyCheck.isSafe) {
    throw new Error(`Invalid webhook URL: ${safetyCheck.reason}`);
  }

  await prisma.webhookEndpoint.create({
    data: {
      userId,
      url: data.url,
      secret,
      eventTypes: data.eventTypes,
    }
  });

  revalidatePath('/dashboard/webhooks');
}

export async function getWebhookEndpoints() {
  const { userId } = await auth();
  if (!userId) return [];

  return await prisma.webhookEndpoint.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getWebhookLogs(endpointId: string) {
  const { userId } = await auth();
  if (!userId) return [];

  // Verify ownership
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId }
  });
  if (endpoint?.userId !== userId) return [];

  return await prisma.webhookDeliveryLog.findMany({
    where: { endpointId },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}

export async function deleteWebhookEndpoint(endpointId: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  await prisma.webhookEndpoint.delete({
    where: { id: endpointId, userId }
  });

  revalidatePath('/dashboard/webhooks');
}
export async function saveDiscordWebhookUrl(url: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  await ensureUserExists(userId);

  const trimmed = url.trim();
  if (trimmed && !isValidDiscordWebhookUrl(trimmed)) {
    throw new Error('That doesn\'t look like a valid Discord webhook URL');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { discordWebhookUrl: trimmed || null },
  });

  revalidatePath('/dashboard/webhooks');
}
export async function getDiscordWebhookUrl() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { discordWebhookUrl: true },
  });

  return user?.discordWebhookUrl ?? null;
}

export async function saveTelegramWebhookUrl(url: string) {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  await ensureUserExists(userId);

  const trimmed = url.trim();
  if (trimmed && !isValidTelegramWebhookUrl(trimmed)) {
    throw new Error('That doesn\'t look like a valid Telegram webhook URL');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { telegramWebhookUrl: trimmed || null },
  });

  revalidatePath('/dashboard/webhooks');
}

export async function getTelegramWebhookUrl() {
  const { userId } = await auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramWebhookUrl: true },
  });

  return user?.telegramWebhookUrl ?? null;
}