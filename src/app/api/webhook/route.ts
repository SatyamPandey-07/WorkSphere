import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error("Please add WEBHOOK_SECRET from Clerk Dashboard to .env");
  }

  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error occured -- no svix headers", {
      status: 400,
    });
  }

  // Get the body
  const body = await req.text();

  // Create a new Svix instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify the payload with the headers
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error occured", {
      status: 400,
    });
  }

  // Handle the webhook
  const eventType = evt.type;

  if (eventType === "user.created") {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data;

    const email = email_addresses[0]?.email_address;
    const initials = `${first_name?.[0] || ""}${last_name?.[0] || ""}`.toUpperCase();
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials || "WS")}&background=6366f1&color=fff`;
    
    // Safely optimize URL size to 150px if it exists, fallback to placeholder initials avatar if null/empty
    const imageUrl = image_url
      ? image_url.replace(/(\?|&)sz=\d+/, "$1sz=150").replace(/(\?|&)width=\d+/, "$1width=150")
      : fallbackUrl;

    try {
      await prisma.user.create({
        data: {
          id,
          email,
          firstName: first_name,
          lastName: last_name,
          imageUrl,
        },
      });

      console.log("User created in database:", id);
    } catch (error) {
      console.error("Error creating user:", error);
      // Don't throw error to avoid webhook retries
    }
  }

  if (eventType === "user.updated") {
    const { id, email_addresses, first_name, last_name, image_url } = evt.data;

    const email = email_addresses[0]?.email_address;
    const initials = `${first_name?.[0] || ""}${last_name?.[0] || ""}`.toUpperCase();
    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials || "WS")}&background=6366f1&color=fff`;

    const imageUrl = image_url
      ? image_url.replace(/(\?|&)sz=\d+/, "$1sz=150").replace(/(\?|&)width=\d+/, "$1width=150")
      : fallbackUrl;

    try {
      await prisma.user.update({
        where: { id },
        data: {
          email,
          firstName: first_name,
          lastName: last_name,
          imageUrl,
        },
      });

      console.log("User updated in database:", id);
    } catch (error) {
      console.error("Error updating user:", error);
    }
  }

  if (eventType === "user.deleted") {
    const { id } = evt.data;

    try {
      await prisma.user.delete({
        where: { id: id! },
      });

      console.log("User deleted from database:", id);
    } catch (error) {
      console.error("Error deleting user:", error);
    }
  }

  return new Response("", { status: 200 });
}
