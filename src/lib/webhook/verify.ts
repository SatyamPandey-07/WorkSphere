import { Webhook } from "svix";

export function verifyWebhookPayload(
  payload: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  secret: string,
): unknown {
  if (!svixId || !svixTimestamp || !svixSignature) {
    return null;
  }

  const wh = new Webhook(secret);
  try {
    return wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return null;
  }
}
