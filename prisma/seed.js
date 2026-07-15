const { PrismaClient } = require("@prisma/client");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config({ path: ".env.local" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const mockVenues = [
  {
    placeId: "osm-venue-1",
    name: "Brooklyn Standard Cafe",
    latitude: 40.7182,
    longitude: -73.9563,
    category: "cafe",
    address: "188 Nassau Ave, Brooklyn, NY 11222",
    wifiQuality: 4,
    hasOutlets: true,
    noiseLevel: "moderate",
    hasErgonomic: false,
    outletDensity: "some_tables",
    wifiSpeed: 85,
    crowdsourced: true,
  },
  {
    placeId: "osm-venue-2",
    name: "Dumbo WorkSpace Collective",
    latitude: 40.7024,
    longitude: -73.9902,
    category: "coworking",
    address: "45 Main St, Brooklyn, NY 11201",
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
    hasErgonomic: true,
    outletDensity: "every_table",
    wifiSpeed: 180,
    crowdsourced: true,
  },
  {
    placeId: "osm-venue-3",
    name: "Brooklyn Public Library - Central",
    latitude: 40.6728,
    longitude: -73.9682,
    category: "library",
    address: "10 Grand Army Plaza, Brooklyn, NY 11238",
    wifiQuality: 3,
    hasOutlets: true,
    noiseLevel: "quiet",
    hasErgonomic: false,
    outletDensity: "wall_seats",
    wifiSpeed: 25,
    crowdsourced: true,
  },
  {
    placeId: "osm-venue-4",
    name: "Williamsburg Roast & Write",
    latitude: 40.7145,
    longitude: -73.9612,
    category: "cafe",
    address: "105 Bedford Ave, Brooklyn, NY 11211",
    wifiQuality: 4,
    hasOutlets: true,
    noiseLevel: "moderate",
    hasErgonomic: false,
    outletDensity: "some_tables",
    wifiSpeed: 60,
    crowdsourced: true,
  },
  {
    placeId: "osm-venue-5",
    name: "Greenpoint Quiet Hub",
    latitude: 40.7301,
    longitude: -73.9543,
    category: "coworking",
    address: "67 West St, Brooklyn, NY 11222",
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
    hasErgonomic: true,
    outletDensity: "every_table",
    wifiSpeed: 250,
    crowdsourced: true,
  }
];

async function main() {
  console.log("Starting database seed...");

  // 1. Upsert a mock test user (Clerk ID: clerk_test_user_1)
  const testUser = await prisma.user.upsert({
    where: { id: "clerk_test_user_1" },
    update: {},
    create: {
      id: "clerk_test_user_1",
      email: "nomad@worksphere.dev",
      firstName: "Nomad",
      lastName: "Scout",
    },
  });
  console.log(`Mock user created/verified: ${testUser.email}`);

  // 2. Loop and upsert mock venues
  for (const vData of mockVenues) {
    const venue = await prisma.venue.upsert({
      where: { placeId: vData.placeId },
      update: {
        name: vData.name,
        latitude: vData.latitude,
        longitude: vData.longitude,
        category: vData.category,
        address: vData.address,
        wifiQuality: vData.wifiQuality,
        hasOutlets: vData.hasOutlets,
        noiseLevel: vData.noiseLevel,
        hasErgonomic: vData.hasErgonomic,
        outletDensity: vData.outletDensity,
        wifiSpeed: vData.wifiSpeed,
      },
      create: {
        placeId: vData.placeId,
        name: vData.name,
        latitude: vData.latitude,
        longitude: vData.longitude,
        category: vData.category,
        address: vData.address,
        wifiQuality: vData.wifiQuality,
        hasOutlets: vData.hasOutlets,
        noiseLevel: vData.noiseLevel,
        hasErgonomic: vData.hasErgonomic,
        outletDensity: vData.outletDensity,
        wifiSpeed: vData.wifiSpeed,
        crowdsourced: vData.crowdsourced,
      },
    });
    console.log(`Venue seeded: ${venue.name}`);

    // 3. Upsert a mock rating for this venue by our test user
    await prisma.venueRating.upsert({
      where: {
        userId_venueId: {
          userId: testUser.id,
          venueId: venue.id,
        },
      },
      update: {
        wifiQuality: vData.wifiQuality,
        hasOutlets: vData.hasOutlets,
        noiseLevel: vData.noiseLevel,
        hasErgonomic: vData.hasErgonomic,
        outletDensity: vData.outletDensity,
        wifiSpeed: vData.wifiSpeed,
        comment: `Excellent workspace with decent ${vData.category} vibes and reliable internet connectivity.`,
      },
      create: {
        userId: testUser.id,
        venueId: venue.id,
        wifiQuality: vData.wifiQuality,
        hasOutlets: vData.hasOutlets,
        noiseLevel: vData.noiseLevel,
        hasErgonomic: vData.hasErgonomic,
        outletDensity: vData.outletDensity,
        wifiSpeed: vData.wifiSpeed,
        comment: `Excellent workspace with decent ${vData.category} vibes and reliable internet connectivity.`,
      },
    });
    console.log(`Rating seeded for venue: ${venue.name}`);

    // 4. Seed mock telemetry data for each venue
    const crowdLevels = ["empty", "moderate", "busy", "very busy"];
    const now = new Date();
    for (let i = 0; i < 20; i++) {
      const timestamp = new Date(now.getTime() - i * 3600000); // 1 hour intervals
      const crowdLevel = crowdLevels[Math.floor(Math.random() * crowdLevels.length)];
      let multiplier = 1.0;
      if (crowdLevel === "busy") multiplier = 0.7;
      if (crowdLevel === "very busy") multiplier = 0.5;

      await prisma.wifiTelemetry.create({
        data: {
          venueId: venue.id,
          download: Math.round(vData.wifiSpeed * multiplier * (0.9 + Math.random() * 0.2)),
          upload: Math.round(vData.wifiSpeed * 0.5 * multiplier * (0.9 + Math.random() * 0.2)),
          latency: Math.round(20 + Math.random() * 30),
          crowdLevel,
          timestamp,
        },
      });
    }
    console.log(`Telemetry seeded for venue: ${venue.name}`);
  }

  console.log("Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
