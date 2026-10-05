/**
 * Compatibility bridge: Re-export Telegram notification utilities from consolidated @/lib/notifications module.
 */

export * from "@/lib/notifications";

export function buildTelegramVenueAlert(params: {
  event: "booking" | "checkin";
  userName: string;
  venueName: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): { text: string; inlineKeyboard?: Array<Array<{ text: string; url: string }>> } {
  const { event, userName, venueName, address, latitude, longitude } = params;

  const actionText = event === "booking" ? "booked a spot at" : "checked in at";
  let text = `<b>${userName}</b> ${actionText} <b>${venueName}</b>!`;

  if (address) {
    text += `\n📍 <i>Address: ${address}</i>`;
  }

  if (latitude != null && longitude != null) {
    text += `\n🌐 <i>Coordinates: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}</i>`;
  }

  const inlineKeyboard =
    latitude != null && longitude != null
      ? [
          [
            {
              text: "Get Directions 🗺️",
              url: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
            },
          ],
        ]
      : undefined;

  return { text, inlineKeyboard };
}
