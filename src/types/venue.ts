export interface Venue {
  id: string;
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  category: "cafe" | "coworking" | "library";
  address?: string;
  rating?: number;
  wifiQuality?: number;
  hasOutlets?: boolean;
  noiseLevel?: "quiet" | "moderate" | "loud";
  crowdsourced?: boolean;
  distance?: number;
  duration?: number;
  score?: number;
  scoreBreakdown?: {
    wifi: number;
    noise: number;
    outlets: number;
    rating: number;
    distance: number;
  };
}

export interface VenueSearchParams {
  latitude: number;
  longitude: number;
  radius?: number;
  category?: string[];
  amenities?: string[];
  workType?: "focus" | "calls" | "collaboration" | "casual";
}

export interface VenueRating {
  wifiQuality: number;
  hasOutlets: boolean;
  noiseLevel: "quiet" | "moderate" | "loud";
  comment?: string;
}
