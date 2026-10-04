import { NextRequest } from "next/server";
import { DOMParser } from "@xmldom/xmldom";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { GET as exportFolder } from "@/app/api/folders/[id]/export/route";
import {
  GEO_EXPORT_VENUE_SELECT,
  KML_NAMESPACE,
  buildGeoExportFilename,
  escapeXml,
  generateGeoJson,
  generateKml,
  hasValidCoordinates,
  normalizeVenueAmenities,
  parseGeoExportFormat,
  type GeoExportVenue,
} from "@/lib/folderGeoExport";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

// Only Prisma is mocked: the real `hasFolderAccess` ownership logic runs.
jest.mock("@/lib/prisma", () => ({
  prisma: {
    folder: { findUnique: jest.fn() },
    folderVenue: { findMany: jest.fn() },
  },
}));

const APP_URL = "https://worksphere.example";

const coffeeAndCo: GeoExportVenue = {
  id: "venue_coffee",
  name: "Coffee & Co.",
  // Deliberately asymmetric so a lat/lng swap is detectable.
  latitude: 40.7128,
  longitude: -74.006,
  address: '"Downtown" <Main Office>',
  category: "cafe",
  wifiQuality: 4,
  wifiSpeed: null,
  hasOutlets: true,
  hasPhoneBooths: true,
  dogFriendly: true,
};

const tomAndJerry: GeoExportVenue = {
  id: "venue_library",
  name: "Tom & Jerry's <Library>",
  latitude: 51.5074,
  longitude: -0.1278,
  address: null,
  category: "library",
  wifiQuality: null,
  wifiSpeed: null,
};

/** Stub created by api/favorites/tags/sync when coordinates are unknown. */
const placeholderVenue: GeoExportVenue = {
  id: "venue_unknown",
  name: "Unknown Venue",
  latitude: 0,
  longitude: 0,
  address: null,
  category: "other",
};

const nanVenue: GeoExportVenue = {
  ...tomAndJerry,
  id: "venue_nan",
  name: "Broken Coordinates",
  latitude: Number.NaN,
};

function parseXml(xml: string) {
  const errors: string[] = [];
  // jsdom's XML parser is strict XML 1.0 (rejects e.g. a bare "&", which
  // @xmldom/xmldom tolerates), so use it as the well-formedness oracle.
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

function kmlElements(xml: string, tag: string) {
  const { doc, errors } = parseXml(xml);
  expect(errors).toEqual([]);
  return Array.from(doc.getElementsByTagNameNS(KML_NAMESPACE, tag));
}

/** Renders a KML balloon description as HTML, the way Google Earth would. */
function renderDescription(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

describe("folder geographic export (#3477)", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("XML validity check used by these tests rejects unescaped content", () => {
    expect(parseXml("<a>Tom &amp; Jerry</a>").errors).toEqual([]);
    expect(parseXml("<a>Tom & Jerry</a>").errors).not.toEqual([]);
    expect(parseXml('<a b="x"y">z</a>').errors).not.toEqual([]);
    expect(parseXml("<a>\u0000</a>").errors).not.toEqual([]);
  });

  describe("parseGeoExportFormat", () => {
    it("accepts supported formats case-insensitively", () => {
      expect(parseGeoExportFormat("geojson")).toBe("geojson");
      expect(parseGeoExportFormat("GeoJSON")).toBe("geojson");
      expect(parseGeoExportFormat(" KML ")).toBe("kml");
    });

    it("rejects missing and unsupported formats instead of defaulting", () => {
      expect(parseGeoExportFormat(null)).toBeNull();
      expect(parseGeoExportFormat("")).toBeNull();
      expect(parseGeoExportFormat("csv")).toBeNull();
      expect(parseGeoExportFormat("geojson;kml")).toBeNull();
    });
  });

  describe("hasValidCoordinates", () => {
    it("accepts finite in-range coordinates", () => {
      expect(hasValidCoordinates(coffeeAndCo)).toBe(true);
      expect(hasValidCoordinates({ latitude: 0, longitude: 12.5 })).toBe(true);
    });

    it("rejects NaN, Infinity, out-of-range and (0,0) placeholder coordinates", () => {
      expect(hasValidCoordinates(nanVenue)).toBe(false);
      expect(
        hasValidCoordinates({ latitude: 10, longitude: Infinity }),
      ).toBe(false);
      expect(hasValidCoordinates({ latitude: 91, longitude: 0.5 })).toBe(false);
      expect(hasValidCoordinates({ latitude: 10, longitude: -181 })).toBe(
        false,
      );
      expect(hasValidCoordinates(placeholderVenue)).toBe(false);
    });
  });

  describe("normalizeVenueAmenities", () => {
    it("maps venue boolean columns to readable labels", () => {
      expect(normalizeVenueAmenities(coffeeAndCo)).toEqual([
        "Wi-Fi",
        "Power outlets",
        "Phone booths",
        "Dog friendly",
      ]);
    });

    it("returns an empty array when a venue has no amenities", () => {
      expect(normalizeVenueAmenities(tomAndJerry)).toEqual([]);
    });
  });

  describe("buildGeoExportFilename", () => {
    it("builds a deterministic slug with the format extension", () => {
      expect(buildGeoExportFilename("My Favorites", "geojson")).toBe(
        "my-favorites.geojson",
      );
      expect(buildGeoExportFilename("My Favorites", "kml")).toBe(
        "my-favorites.kml",
      );
    });

    it("strips header-unsafe characters", () => {
      const filename = buildGeoExportFilename(
        `Team "A" 'B' / \\ : * ? < > | \r\nX-Injected: 1`,
        "kml",
      );
      expect(filename).toBe("team-a-b-x-injected-1.kml");
      expect(filename).toMatch(/^[a-z0-9-]+\.kml$/);
    });

    it("falls back when the name has no safe characters", () => {
      expect(buildGeoExportFilename('"/\\:*?<>|', "geojson")).toBe(
        "collection.geojson",
      );
    });
  });

  describe("generateGeoJson", () => {
    it("produces an RFC 7946 FeatureCollection of Point features", () => {
      const geojson = generateGeoJson([coffeeAndCo, tomAndJerry]);

      expect(geojson.type).toBe("FeatureCollection");
      expect(Array.isArray(geojson.features)).toBe(true);
      expect(geojson).not.toHaveProperty("crs");
      for (const feature of geojson.features) {
        expect(feature.type).toBe("Feature");
        expect(feature.geometry.type).toBe("Point");
        expect(feature.geometry.coordinates).toHaveLength(2);
        feature.geometry.coordinates.forEach((n) =>
          expect(Number.isFinite(n)).toBe(true),
        );
        expect(feature.properties).toBeDefined();
      }
    });

    it("orders coordinates as [longitude, latitude]", () => {
      const [feature] = generateGeoJson([coffeeAndCo]).features;
      expect(feature.geometry.coordinates).toEqual([-74.006, 40.7128]);
      expect(feature.geometry.coordinates).not.toEqual([40.7128, -74.006]);
    });

    it("exports name, address, category, amenities and workSphereUrl only", () => {
      const [coffee, library] = generateGeoJson([
        coffeeAndCo,
        tomAndJerry,
      ]).features;

      expect(coffee.properties).toEqual({
        name: "Coffee & Co.",
        address: '"Downtown" <Main Office>',
        category: "cafe",
        amenities: ["Wi-Fi", "Power outlets", "Phone booths", "Dog friendly"],
        workSphereUrl: `${APP_URL}/venues/venue_coffee`,
      });
      expect(library.properties).toEqual({
        name: "Tom & Jerry's <Library>",
        address: null,
        category: "library",
        amenities: [],
        workSphereUrl: `${APP_URL}/venues/venue_library`,
      });
    });

    it("emits one feature per venue with valid coordinates", () => {
      const geojson = generateGeoJson([
        coffeeAndCo,
        placeholderVenue,
        tomAndJerry,
        nanVenue,
      ]);
      expect(geojson.features.map((f) => f.id)).toEqual([
        "venue_coffee",
        "venue_library",
      ]);
      expect(JSON.stringify(geojson)).not.toContain("null,null");
    });

    it("returns a valid empty FeatureCollection for an empty folder", () => {
      expect(generateGeoJson([])).toEqual({
        type: "FeatureCollection",
        features: [],
      });
    });

    it("round-trips special characters through valid JSON", () => {
      const text = JSON.stringify(generateGeoJson([coffeeAndCo, tomAndJerry]));
      const parsed = JSON.parse(text);
      expect(parsed.features[0].properties.name).toBe("Coffee & Co.");
      expect(parsed.features[0].properties.address).toBe(
        '"Downtown" <Main Office>',
      );
      expect(parsed.features[1].properties.name).toBe(
        "Tom & Jerry's <Library>",
      );
    });

    it("URL-encodes venue ids in workSphereUrl", () => {
      const [feature] = generateGeoJson([
        { ...coffeeAndCo, id: "../admin?x=<1>" },
      ]).features;
      expect(feature.properties.workSphereUrl).toBe(
        `${APP_URL}/venues/..%2Fadmin%3Fx%3D%3C1%3E`,
      );
    });
  });

  describe("generateKml", () => {
    const folder = { name: "Team <Hubs> & \"Friends\"", description: null };

    it("produces well-formed KML 2.2 with a Document root", () => {
      const kml = generateKml([coffeeAndCo], folder);
      const { doc, errors } = parseXml(kml);

      expect(errors).toEqual([]);
      expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
      expect(doc.documentElement?.localName).toBe("kml");
      expect(doc.documentElement?.namespaceURI).toBe(KML_NAMESPACE);

      const documents = kmlElements(kml, "Document");
      expect(documents).toHaveLength(1);
      const docName = kmlElements(kml, "name")[0];
      expect(docName.textContent).toBe(folder.name);
    });

    it("emits one Placemark per valid venue with the venue name", () => {
      const kml = generateKml(
        [coffeeAndCo, placeholderVenue, tomAndJerry, nanVenue],
        folder,
      );
      const placemarks = kmlElements(kml, "Placemark");

      expect(placemarks).toHaveLength(2);
      const names = placemarks.map(
        (p) => p.getElementsByTagNameNS(KML_NAMESPACE, "name")[0].textContent,
      );
      expect(names).toEqual(["Coffee & Co.", "Tom & Jerry's <Library>"]);
      placemarks.forEach((p) =>
        expect(p.getElementsByTagNameNS(KML_NAMESPACE, "Point")).toHaveLength(
          1,
        ),
      );
    });

    it("writes coordinates as longitude,latitude,0 (not reversed)", () => {
      const kml = generateKml([coffeeAndCo, tomAndJerry], folder);
      const coords = kmlElements(kml, "coordinates").map((c) =>
        c.textContent?.trim(),
      );

      expect(coords).toEqual(["-74.006,40.7128,0", "-0.1278,51.5074,0"]);
      expect(kml).not.toContain("40.7128,-74.006");
    });

    it("never writes coordinates in exponent notation", () => {
      const kml = generateKml(
        [{ ...coffeeAndCo, latitude: 0.00000004, longitude: 10 }],
        folder,
      );
      const [coords] = kmlElements(kml, "coordinates");
      expect(coords.textContent).toBe("10,0,0");
    });

    it("includes address, category, amenities and WorkSphere link in the description", () => {
      const kml = generateKml([coffeeAndCo], folder);
      const [description] = kmlElements(kml, "description");
      const html = description.textContent ?? "";
      const rendered = renderDescription(html);

      expect(rendered.textContent).toContain(
        'Address: "Downtown" <Main Office>',
      );
      expect(rendered.textContent).toContain("Category: cafe");
      expect(rendered.textContent).toContain(
        "Amenities: Wi-Fi, Power outlets, Phone booths, Dog friendly",
      );
      const links = rendered.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toBe(
        `${APP_URL}/venues/venue_coffee`,
      );
      expect(links[0].textContent).toBe("View on WorkSphere");
    });

    it("describes missing address and amenities without breaking", () => {
      const kml = generateKml([tomAndJerry], folder);
      const [description] = kmlElements(kml, "description");
      const rendered = renderDescription(description.textContent ?? "");

      expect(rendered.textContent).toContain("Address: Not available");
      expect(rendered.textContent).toContain("Amenities: None listed");
    });

    it("escapes & < > \" ' so the document stays parseable", () => {
      const hostile: GeoExportVenue = {
        ...coffeeAndCo,
        name: `Tom & Jerry <Main Office> "Downtown" 'Q'`,
        address: `</description></Placemark><Placemark><name>pwn</name>`,
        category: `]]><![CDATA[ & <cat>`,
      };
      const kml = generateKml([hostile], folder);
      const placemarks = kmlElements(kml, "Placemark");

      expect(placemarks).toHaveLength(1);
      expect(
        placemarks[0].getElementsByTagNameNS(KML_NAMESPACE, "name")[0]
          .textContent,
      ).toBe(hostile.name);
      expect(kml).not.toContain("<Main Office>");
      expect(kml).not.toContain("<name>pwn</name>");
    });

    it("prevents HTML injection in the rendered description", () => {
      const hostile: GeoExportVenue = {
        ...coffeeAndCo,
        address: `<script>alert(1)</script><img src=x onerror="alert(2)">`,
        category: `<a href="javascript:alert(3)">click</a>`,
      };
      const kml = generateKml([hostile], folder);
      const [description] = kmlElements(kml, "description");
      const rendered = renderDescription(description.textContent ?? "");

      expect(rendered.querySelector("script, img")).toBeNull();
      const links = rendered.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute("href")).toBe(
        `${APP_URL}/venues/venue_coffee`,
      );
      expect(rendered.textContent).toContain(hostile.address);
    });

    it("drops characters that are illegal in XML 1.0", () => {
      const kml = generateKml(
        [{ ...coffeeAndCo, name: "Bad\u0000Char\u0007Cafe\uD800" }],
        folder,
      );
      const [placemark] = kmlElements(kml, "Placemark");
      expect(
        placemark.getElementsByTagNameNS(KML_NAMESPACE, "name")[0].textContent,
      ).toBe("BadCharCafe");
    });

    it("produces a valid Document with zero Placemarks for an empty folder", () => {
      const kml = generateKml([], { name: "Empty" });
      expect(kmlElements(kml, "Document")).toHaveLength(1);
      expect(kmlElements(kml, "Placemark")).toHaveLength(0);
    });

    it("escapeXml escapes all five XML special characters", () => {
      expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    });
  });

  describe("GET /api/folders/[id]/export", () => {
    const mockAuth = auth as unknown as jest.Mock;
    const mockFindFolder = prisma.folder.findUnique as unknown as jest.Mock;
    const mockFindFolderVenues = prisma.folderVenue
      .findMany as unknown as jest.Mock;

    const ownerId = "user_owner";
    const privateFolder = {
      id: "folder_1",
      name: 'My "Faves" / Work: Spots?',
      description: "Places we like",
      ownerId,
      isPublic: false,
      members: [{ userId: "user_member", role: "MEMBER" }],
    };

    function request(query: string) {
      return new NextRequest(
        `http://localhost/api/folders/folder_1/export${query}`,
      );
    }

    function callExport(query: string, id = "folder_1") {
      return exportFolder(request(query), {
        params: Promise.resolve({ id }),
      });
    }

    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(console, "error").mockImplementation(() => {});
      mockAuth.mockResolvedValue({ userId: ownerId });
      mockFindFolder.mockResolvedValue(privateFolder);
      mockFindFolderVenues.mockResolvedValue([
        { venue: coffeeAndCo },
        { venue: placeholderVenue },
        { venue: tomAndJerry },
      ]);
    });

    afterEach(() => {
      (console.error as jest.Mock).mockRestore();
    });

    it("returns GeoJSON with geo+json content type and attachment filename", async () => {
      const res = await callExport("?format=geojson");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/geo+json");
      const disposition = res.headers.get("Content-Disposition") ?? "";
      expect(disposition).toMatch(/^attachment; filename="[a-z0-9-]+\.geojson"$/);
      expect(disposition).toBe(
        'attachment; filename="my-faves-work-spots.geojson"',
      );

      const body = JSON.parse(await res.text());
      expect(body.type).toBe("FeatureCollection");
      expect(body.features).toHaveLength(2);
      expect(body.features[0].geometry.coordinates).toEqual([-74.006, 40.7128]);
    });

    it("returns KML with google-earth content type and attachment filename", async () => {
      const res = await callExport("?format=kml");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe(
        "application/vnd.google-earth.kml+xml",
      );
      const disposition = res.headers.get("Content-Disposition") ?? "";
      expect(disposition).toMatch(/^attachment; filename="[a-z0-9-]+\.kml"$/);

      const kml = await res.text();
      expect(kmlElements(kml, "Placemark")).toHaveLength(2);
      expect(kmlElements(kml, "name")[0].textContent).toBe(privateFolder.name);
    });

    it("accepts the format parameter case-insensitively", async () => {
      expect((await callExport("?format=GeoJSON")).status).toBe(200);
      expect((await callExport("?format=KML")).status).toBe(200);
    });

    it("loads all folder venues in a single, column-limited query", async () => {
      const many = Array.from({ length: 500 }, (_, i) => ({
        venue: {
          ...coffeeAndCo,
          id: `venue_${i}`,
          latitude: 10 + i / 1000,
          longitude: 20 + i / 1000,
        },
      }));
      mockFindFolderVenues.mockResolvedValue(many);

      const res = await callExport("?format=geojson");
      const body = JSON.parse(await res.text());

      expect(body.features).toHaveLength(500);
      expect(mockFindFolder).toHaveBeenCalledTimes(1);
      expect(mockFindFolderVenues).toHaveBeenCalledTimes(1);
      expect(mockFindFolderVenues).toHaveBeenCalledWith({
        where: { folderId: "folder_1" },
        select: { venue: { select: GEO_EXPORT_VENUE_SELECT } },
        orderBy: { createdAt: "desc" },
      });
      const selected = Object.keys(GEO_EXPORT_VENUE_SELECT);
      for (const sensitive of [
        "ownerId",
        "creatorId",
        "hostMessage",
        "placeId",
        "googlePlaceId",
      ]) {
        expect(selected).not.toContain(sensitive);
      }
    });

    it("does not leak unexpected venue fields into the export", async () => {
      mockFindFolderVenues.mockResolvedValue([
        {
          venue: {
            ...coffeeAndCo,
            ownerId: "secret_owner",
            hostMessage: "internal note",
          },
        },
      ]);

      const geo = await (await callExport("?format=geojson")).text();
      const kml = await (await callExport("?format=kml")).text();

      for (const output of [geo, kml]) {
        expect(output).not.toContain("secret_owner");
        expect(output).not.toContain("internal note");
      }
      expect(Object.keys(JSON.parse(geo).features[0].properties).sort()).toEqual(
        ["address", "amenities", "category", "name", "workSphereUrl"],
      );
    });

    it("exports an empty folder as an empty FeatureCollection", async () => {
      mockFindFolderVenues.mockResolvedValue([]);
      const res = await callExport("?format=geojson");

      expect(res.status).toBe(200);
      expect(JSON.parse(await res.text())).toEqual({
        type: "FeatureCollection",
        features: [],
      });
    });

    it("returns 400 when format is missing", async () => {
      const res = await callExport("");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/format/i);
      expect(body.error).toContain("geojson, kml");
      expect(mockFindFolder).not.toHaveBeenCalled();
    });

    it("returns 400 for an unsupported format instead of defaulting", async () => {
      const res = await callExport("?format=something-else");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/unsupported export format/i);
      expect(mockFindFolderVenues).not.toHaveBeenCalled();
    });

    it("returns 401 for unauthenticated requests without touching the DB", async () => {
      mockAuth.mockResolvedValue({ userId: null });
      const res = await callExport("?format=geojson");

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
      expect(mockFindFolder).not.toHaveBeenCalled();
      expect(mockFindFolderVenues).not.toHaveBeenCalled();
    });

    it("returns 404 when the folder does not exist", async () => {
      mockFindFolder.mockResolvedValue(null);
      const res = await callExport("?format=kml", "missing_folder");

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Folder not found" });
      expect(mockFindFolder).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "missing_folder" } }),
      );
      expect(mockFindFolderVenues).not.toHaveBeenCalled();
    });

    it("returns 403 when another user exports a private folder they do not belong to", async () => {
      mockAuth.mockResolvedValue({ userId: "user_intruder" });

      for (const format of ["geojson", "kml"]) {
        const res = await callExport(`?format=${format}`);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "Forbidden" });
      }
      expect(mockFindFolderVenues).not.toHaveBeenCalled();
    });

    it("allows folder members to export", async () => {
      mockAuth.mockResolvedValue({ userId: "user_member" });
      const res = await callExport("?format=kml");
      expect(res.status).toBe(200);
    });

    it("allows exporting public folders, matching existing read access rules", async () => {
      mockAuth.mockResolvedValue({ userId: "user_intruder" });
      mockFindFolder.mockResolvedValue({ ...privateFolder, isPublic: true });
      const res = await callExport("?format=geojson");
      expect(res.status).toBe(200);
    });

    it("returns 500 with a JSON error when the database fails", async () => {
      mockFindFolderVenues.mockRejectedValue(new Error("db down"));
      const res = await callExport("?format=geojson");

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to export folder" });
    });
  });
});
