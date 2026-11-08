import { NextRequest } from "next/server";
import { DOMParser } from "@xmldom/xmldom";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { GET as exportFavorites } from "@/app/api/favorites/export/route";
import {
  generateFavoritesGeoJson,
  generateFavoritesKml,
  parseGeoExportFormat,
  hasValidCoordinates,
  FavoriteExportItem,
  GEOJSON_CONTENT_TYPE,
  KML_CONTENT_TYPE,
  KML_NAMESPACE,
} from "@/lib/favoritesGeoExport";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/auth", () => ({
  ensureUserExists: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    favorite: {
      findMany: jest.fn(),
    },
  },
}));

function parseXml(xml: string) {
  const errors: string[] = [];
  const strict = new window.DOMParser().parseFromString(xml, "application/xml");
  const parserError = strict.getElementsByTagName("parsererror")[0];
  if (parserError) errors.push(`strict: ${parserError.textContent}`);

  const parser = new DOMParser({
    onError: (level: string, message: string) =>
      errors.push(`${level}: ${message}`),
  });
  let doc = parser.parseFromString("<empty/>", "text/xml");
  try {
    doc = parser.parseFromString(xml, "text/xml");
  } catch (error) {
    errors.push(`xmldom: ${(error as Error).message}`);
  }
  return { doc, errors };
}

describe("favorites geographic export (#3787)", () => {
  const mockFavorites: FavoriteExportItem[] = [
    {
      id: "fav_1",
      venueId: "venue_1",
      notes: "Great corner desk near window",
      venue: {
        id: "venue_1",
        name: "Cafe Mocha",
        latitude: 37.7749,
        longitude: -122.4194,
        category: "Cafe",
        address: "123 Market St",
        rating: 4.8,
        wifiQuality: 5,
        wifiSpeed: 100,
        hasOutlets: true,
        noiseLevel: "moderate",
      },
      tags: [
        { id: "t1", name: "Quiet", color: "#blue" },
        { id: "t2", name: "Fast WiFi", color: "#green" },
      ],
    },
    {
      id: "fav_2",
      venueId: "venue_2",
      notes: null,
      venue: {
        id: "venue_2",
        name: "Central Library & Co.",
        latitude: 40.7128,
        longitude: -74.006,
        category: "Library",
        address: "456 5th Ave",
        rating: 4.5,
        hasOutlets: false,
      },
      tags: [],
    },
    {
      id: "fav_invalid",
      venueId: "venue_invalid",
      venue: {
        id: "venue_invalid",
        name: "Nowhere Venue",
        latitude: 0,
        longitude: 0,
        category: "Other",
      },
    },
  ];

  describe("generateFavoritesGeoJson", () => {
    it("converts favorites to standard RFC 7946 GeoJSON FeatureCollection", () => {
      const geojson = generateFavoritesGeoJson(mockFavorites);

      expect(geojson.type).toBe("FeatureCollection");
      // Filtered out the (0,0) coordinate venue
      expect(geojson.features).toHaveLength(2);

      const f1 = geojson.features[0];
      expect(f1.type).toBe("Feature");
      expect(f1.id).toBe("fav_1");
      // Coordinates order must be [longitude, latitude]
      expect(f1.geometry.type).toBe("Point");
      expect(f1.geometry.coordinates).toEqual([-122.4194, 37.7749]);

      expect(f1.properties.name).toBe("Cafe Mocha");
      expect(f1.properties.category).toBe("Cafe");
      expect(f1.properties.address).toBe("123 Market St");
      expect(f1.properties.rating).toBe(4.8);
      expect(f1.properties.tags).toEqual(["Quiet", "Fast WiFi"]);
      expect(f1.properties.notes).toBe("Great corner desk near window");
      expect(f1.properties.wifiQuality).toBe(5);
      expect(f1.properties.wifiSpeed).toBe(100);
      expect(f1.properties.hasOutlets).toBe(true);
      expect(f1.properties.noiseLevel).toBe("moderate");
      expect(f1.properties.workSphereUrl).toContain("/venues/venue_1");
    });
  });

  describe("generateFavoritesKml", () => {
    it("generates valid XML and standard KML Placemarks", () => {
      const kml = generateFavoritesKml(mockFavorites, "WorkSphere Saved Venues");
      const { doc, errors } = parseXml(kml);

      expect(errors).toEqual([]);
      const placemarks = Array.from(doc.getElementsByTagNameNS(KML_NAMESPACE, "Placemark"));
      expect(placemarks).toHaveLength(2);

      const nameEl = placemarks[0].getElementsByTagNameNS(KML_NAMESPACE, "name")[0];
      expect(nameEl?.textContent).toBe("Cafe Mocha");

      const coordsEl = placemarks[0].getElementsByTagNameNS(KML_NAMESPACE, "coordinates")[0];
      expect(coordsEl?.textContent).toBe("-122.4194,37.7749,0");

      // Check special XML character escaping
      const name2El = placemarks[1].getElementsByTagNameNS(KML_NAMESPACE, "name")[0];
      expect(name2El?.textContent).toBe("Central Library & Co.");
    });
  });

  describe("GET /api/favorites/export", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns 401 if user is unauthenticated", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

      const req = new NextRequest("http://localhost:3000/api/favorites/export?format=geojson");
      const res = await exportFavorites(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 400 if format parameter is missing", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });

      const req = new NextRequest("http://localhost:3000/api/favorites/export");
      const res = await exportFavorites(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Missing required "format" query parameter/i);
    });

    it("returns 400 if format parameter is unsupported", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });

      const req = new NextRequest("http://localhost:3000/api/favorites/export?format=csv");
      const res = await exportFavorites(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Unsupported export format/i);
    });

    it("returns 200 with GeoJSON and proper attachment headers", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
      (prisma.favorite.findMany as jest.Mock).mockResolvedValue(mockFavorites);

      const req = new NextRequest("http://localhost:3000/api/favorites/export?format=geojson");
      const res = await exportFavorites(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(GEOJSON_CONTENT_TYPE);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="worksphere-saved-venues.geojson"'
      );

      const data = await res.json();
      expect(data.type).toBe("FeatureCollection");
      expect(data.features).toHaveLength(2);
    });

    it("returns 200 with KML and proper attachment headers", async () => {
      (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
      (prisma.favorite.findMany as jest.Mock).mockResolvedValue(mockFavorites);

      const req = new NextRequest("http://localhost:3000/api/favorites/export?format=kml");
      const res = await exportFavorites(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(KML_CONTENT_TYPE);
      expect(res.headers.get("Content-Disposition")).toBe(
        'attachment; filename="worksphere-saved-venues.kml"'
      );

      const text = await res.text();
      expect(text).toContain("<kml");
      expect(text).toContain("Cafe Mocha");
      expect(text).toContain("Central Library &amp; Co.");
    });
  });
});
