import "server-only";
import { Webhook as StandardWebhook } from "standardwebhooks";

export type ClerkWebhookEvent =
  | {
      type: "user.created";
      data: ClerkUserData;
    }
  | {
      type: "user.updated";
      data: ClerkUserData;
    }
  | {
      type: "user.deleted";
      data: ClerkDeletedUserData;
    }
  | {
      type: string;
      data: Record<string, unknown>;
    };

export interface ClerkEmailAddress {
  id: string;
  email_address?: string | null;
  verification?: {
    status?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface ClerkUserData {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  has_image?: boolean;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmailAddress[] | null;
  [key: string]: unknown;
}

export interface ClerkDeletedUserData {
  id?: string;
  deleted?: boolean;
  [key: string]: unknown;
}

export interface WebhookVerificationHeaders {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
}

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

/**
 * Safely extracts the primary email address from Clerk's payload using null-safe traversal.
 * Priority:
 * 1. Match entry in `email_addresses` where `id === primary_email_address_id`
 * 2. Fall back to the first valid email address in `email_addresses`
 * 3. Return null if `email_addresses` is empty, missing, or contains no valid email.
 */
export function resolvePrimaryEmail(
  emailAddresses?: ClerkEmailAddress[] | null,
  primaryEmailAddressId?: string | null,
): string | null {
  if (!Array.isArray(emailAddresses) || emailAddresses.length === 0) {
    return null;
  }

  const primaryEmail =
    emailAddresses.find((e) => e?.id === primaryEmailAddressId)
      ?.email_address ||
    emailAddresses[0]?.email_address ||
    null;

  return primaryEmail || null;
}

/**
 * Normalizes user profile details, providing initials-based fallback avatars when image is absent
 * and gracefully handling null/empty email addresses.
 */
export function resolveUserProfile(data: ClerkUserData): {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
} {
  const firstName = data?.first_name ?? null;
  const lastName = data?.last_name ?? null;
  const email = resolvePrimaryEmail(
    data?.email_addresses,
    data?.primary_email_address_id,
  );

  const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
    initials || "WS",
  )}&background=6366f1&color=fff`;

  const imageUrl = data?.image_url
    ? data.image_url
        .replace(/(\?|&)sz=\d+/, "$1sz=150")
        .replace(/(\?|&)width=\d+/, "$1width=150")
    : fallbackUrl;

  return {
    id: data.id,
    email,
    firstName,
    lastName,
    imageUrl,
  };
}

export async function handleUserUpdated(
  data: ClerkUserData,
  db: UserUpsertClient,
): Promise<{
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string;
}> {
  const profile = resolveUserProfile(data);

  await db.user.upsert({
    where: { id: profile.id },
    update: {
      ...(profile.email !== null ? { email: profile.email } : {}),
      firstName: profile.firstName,
      lastName: profile.lastName,
      imageUrl: profile.imageUrl,
    },
    create: {
      id: profile.id,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      imageUrl: profile.imageUrl,
    },
  });

  return profile;
}

/**
 * Verifies Clerk webhook signature using official Svix / standardwebhooks verification mechanism.
 */
export function verifyClerkWebhook(
  rawBody: string,
  headers: WebhookVerificationHeaders,
  signingSecret?: string,
): ClerkWebhookEvent {
  const secret =
    signingSecret ||
    process.env.CLERK_WEBHOOK_SIGNING_SECRET ||
    process.env.CLERK_WEBHOOK_SECRET ||
    process.env.WEBHOOK_SECRET;

  if (!secret) {
    throw new WebhookVerificationError(
      "Webhook signing secret is not configured",
      500,
    );
  }

  const { svixId, svixTimestamp, svixSignature } = headers;

  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new WebhookVerificationError(
      "Missing required Svix signature headers",
      400,
    );
  }

  const wh = new StandardWebhook(secret);

  try {
    wh.verify(
      rawBody,
      {
        "webhook-id": svixId,
        "webhook-timestamp": svixTimestamp,
        "webhook-signature": svixSignature,
      },
      { jsonParse: false },
    );
  } catch (error) {
    const errMessage =
      error instanceof Error ? error.message : "Verification failed";
    throw new WebhookVerificationError(
      `Invalid webhook signature: ${errMessage}`,
      400,
    );
  }

  try {
    return JSON.parse(rawBody) as ClerkWebhookEvent;
  } catch {
    throw new WebhookVerificationError("Invalid JSON in webhook payload", 400);
  }
}