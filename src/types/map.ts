export interface MapMarker {
  id: string;
  position: {
    lat: number;
    lng: number;
  };
  name: string;
  category?: string;
  rating?: number;
  score?: number;
  wifiQuality?: number;
  hasOutlets?: boolean;
  noiseLevel?: string;
  distance?: string;
  address?: string;
  amenities?: {
    wifi?: boolean;
    outlets?: boolean;
    quiet?: boolean;
  };
}

export interface MapRoute {
  id: string;
  path: Array<{ lat: number; lng: number }>;
  distance?: number;
  duration?: number;
  isHighlighted?: boolean;
}

export interface MapView {
  center: {
    lat: number;
    lng: number;
  };
  zoom: number;
  animate?: boolean;
}
