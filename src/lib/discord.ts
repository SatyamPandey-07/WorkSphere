/**
 * Compatibility bridge: Re-export Discord notification utilities from consolidated @/lib/notifications module.
 */

export * from "@/lib/notifications";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  image?: { url: string };
  timestamp?: string;
}

export function buildVenueEventEmbed(params: {
  title: string;
  venueName: string;
  address?: string | null;
  imageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): DiscordEmbed {
  const { title, venueName, address, imageUrl, latitude, longitude } = params;

  const fields: DiscordEmbedField[] = [];
  if (address) fields.push({ name: "Address", value: address, inline: false });
  if (latitude != null && longitude != null) {
    fields.push({
      name: "Coordinates",
      value: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      inline: true,
    });
    fields.push({
      name: "Directions",
      value: `[Open in Maps](https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude})`,
      inline: true,
    });
  }

  return {
    title,
    description: `📍 ${venueName}`,
    fields,
    image: imageUrl ? { url: imageUrl } : undefined,
  };
}