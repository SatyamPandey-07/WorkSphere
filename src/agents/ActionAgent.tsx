import { ScoredVenue } from "./ReasoningAgent";

/**
 * Action Agent
 * Generates UI update instructions and user-facing messages
 * Coordinates map updates with chat responses
 */

export interface ActionInput {
  rankedVenues: ScoredVenue[];
  userQuery: string;
  showRoutes?: boolean;
  userLocation?: { lat: number; lng: number };
}

export interface ActionOutput {
  mapUpdates: {
    markers?: any[];
    routes?: any;
    view?: any;
  };
  message: string;
  suggestions?: string[];
}

/**
 * Generate actions for UI based on reasoning results
 */
export function actionAgent(input: ActionInput): ActionOutput {
  const { rankedVenues, userQuery, showRoutes = false, userLocation } = input;

  // Prepare map markers
  const markers = rankedVenues.slice(0, 10).map(venue => ({
    id: venue.id,
    position: {
      lat: venue.latitude,
      lng: venue.longitude,
    },
    name: venue.name,
    category: venue.category,
    rating: venue.rating,
    wifiQuality: venue.wifiQuality,
    hasOutlets: venue.hasOutlets,
    noiseLevel: venue.noiseLevel,
    distance: formatDistance(venue.distance),
    address: venue.address,
    score: venue.score,
  }));

  // Calculate map center (centroid of top results or user location)
  let mapCenter = userLocation || { lat: 0, lng: 0 };
  if (rankedVenues.length > 0) {
    const avgLat = rankedVenues.slice(0, 5).reduce((sum, v) => sum + v.latitude, 0) / Math.min(5, rankedVenues.length);
    const avgLng = rankedVenues.slice(0, 5).reduce((sum, v) => sum + v.longitude, 0) / Math.min(5, rankedVenues.length);
    mapCenter = { lat: avgLat, lng: avgLng };
  }

  // Prepare routes if requested
  let routes = undefined;
  if (showRoutes && userLocation && rankedVenues.length > 0) {
    routes = {
      origin: userLocation,
      destinations: rankedVenues.slice(0, 3).map(v => ({
        id: v.id,
        lat: v.latitude,
        lng: v.longitude,
        name: v.name,
      })),
      mode: "walking",
    };
  }

  // Generate user message
  const message = generateMessage(rankedVenues, userQuery);

  // Generate suggestions
  const suggestions = generateSuggestions(rankedVenues);

  return {
    mapUpdates: {
      markers,
      routes,
      view: {
        center: mapCenter,
        zoom: 14,
        animate: true,
      },
    },
    message,
    suggestions,
  };
}

function generateMessage(venues: ScoredVenue[], query: string): string {
  if (venues.length === 0) {
    return `I couldn't find any workspaces matching "${query}". Try expanding your search radius or adjusting your criteria.`;
  }

  const topVenue = venues[0];
  const count = venues.length;

  let message = `Found **${count}** workspace${count !== 1 ? 's' : ''} for you! 🎯\n\n`;

  // Top recommendation
  message += `### 🏆 Top Pick: ${topVenue.name}\n`;
  message += `📍 ${topVenue.address || 'Address not available'}\n`;
  message += `⭐ Score: ${topVenue.score}/10\n`;
  message += `📏 ${formatDistance(topVenue.distance)} away\n\n`;
  
  // Amenities
  const amenities: string[] = [];
  if (topVenue.wifiQuality && topVenue.wifiQuality >= 4) amenities.push("📶 Strong WiFi");
  if (topVenue.hasOutlets) amenities.push("🔌 Power outlets");
  if (topVenue.noiseLevel === "quiet") amenities.push("🤫 Quiet");
  if (amenities.length > 0) {
    message += amenities.join(" • ") + "\n\n";
  }

  message += `*${topVenue.reasoning}*\n\n`;

  // Show 2-3 more options
  if (venues.length > 1) {
    message += `### Other great options:\n\n`;
    venues.slice(1, 4).forEach((venue, idx) => {
      message += `**${idx + 2}. ${venue.name}** (${venue.score}/10) - ${formatDistance(venue.distance)}\n`;
    });
  }

  return message;
}

function generateSuggestions(venues: ScoredVenue[]): string[] {
  const suggestions: string[] = [];

  if (venues.length > 0) {
    suggestions.push("Show me directions to the top spot");
    suggestions.push("What are the reviews for these places?");
    suggestions.push("Find somewhere closer");
  }

  suggestions.push("Search in a different area");
  suggestions.push("Show coworking spaces only");

  return suggestions;
}

function formatDistance(meters?: number): string {
  if (!meters) return "unknown distance";
  
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  
  return `${(meters / 1000).toFixed(1)}km`;
}
