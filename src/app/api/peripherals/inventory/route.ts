/**
 * route.ts
 * /api/peripherals/inventory
 * Retrieves available hardware peripherals and smart locker bay statuses.
 */

import { NextRequest, NextResponse } from "next/server";
import type { PeripheralItem } from "@/lib/peripherals/peripheralEngine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const venueId = searchParams.get("venueId") || "venue-sf-01";
  const category = searchParams.get("category");

  const inventory: PeripheralItem[] = [
    {
      id: "periph-1",
      venueId,
      name: "LG UltraFine 27-inch 4K USB-C Portable Display",
      category: "MONITOR",
      description:
        "Color-accurate 4K IPS secondary monitor with single USB-C cable power delivery.",
      brand: "LG",
      lockerBayNumber: 1,
      condition: "EXCELLENT",
      hourlyRateUsd: 3.5,
      depositUsd: 50.0,
      isAvailable: true,
      specifications: ["4K UHD (3840x2160)", "65W USB-C PD", "Anti-Glare IPS"],
    },
    {
      id: "periph-2",
      venueId,
      name: "Anker Prime 140W GaN 4-Port Fast Charger",
      category: "CHARGER",
      description:
        "High-output GaN charger capable of powering two MacBook Pros simultaneously.",
      brand: "Anker",
      lockerBayNumber: 2,
      condition: "EXCELLENT",
      hourlyRateUsd: 1.5,
      depositUsd: 20.0,
      isAvailable: true,
      specifications: [
        "140W Total Output",
        "3x USB-C + 1x USB-A",
        "Braided 240W Cable included",
      ],
    },
    {
      id: "periph-3",
      venueId,
      name: "Keychron K2 Wireless Mechanical Keyboard (Brown Switches)",
      category: "KEYBOARD",
      batteryPercent: 35,
      description:
        "Tactile mechanical keyboard optimized for quiet office typing and Mac/Windows layout.",
      brand: "Keychron",
      lockerBayNumber: 3,
      condition: "GOOD",
      hourlyRateUsd: 2.0,
      depositUsd: 30.0,
      isAvailable: false,
      currentRentalId: "rent-9921",
      specifications: [
        "Gateron G Pro Brown",
        "Bluetooth 5.1 & Wired",
        "RGB Backlit",
      ],
    },
    {
      id: "periph-4",
      venueId,
      name: "Logitech MX Master 3S Ergonomic Mouse",
      category: "MOUSE",
      batteryPercent: 18,
      description:
        "Quiet-click ergonomic precision mouse with MagSpeed electromagnetic scroll wheel.",
      brand: "Logitech",
      lockerBayNumber: 4,
      condition: "EXCELLENT",
      hourlyRateUsd: 1.5,
      depositUsd: 25.0,
      isAvailable: true,
      specifications: [
        "8K DPI Darkfield Sensor",
        "Quiet Clicks",
        "USB-C Fast Charging",
      ],
    },
    {
      id: "periph-5",
      venueId,
      name: "Sony WH-1000XM5 Noise Canceling Headset",
      category: "HEADSET",
      batteryPercent: 85,
      description:
        "Industry-leading active noise cancellation for crisp client video calls in busy spaces.",
      brand: "Sony",
      lockerBayNumber: 5,
      condition: "EXCELLENT",
      hourlyRateUsd: 3.0,
      depositUsd: 60.0,
      isAvailable: true,
      specifications: [
        "Auto NC Optimizer",
        "8 Microphones Beamforming",
        "30-Hour Battery",
      ],
    },
    {
      id: "periph-6",
      venueId,
      name: "CalDigit TS4 Thunderbolt 4 Docking Station (18 Ports)",
      category: "ADAPTER",
      description:
        "Pro docking hub with dual 4K/6K monitor support, SD card reader, and 2.5GbE Ethernet.",
      brand: "CalDigit",
      lockerBayNumber: 6,
      condition: "GOOD",
      hourlyRateUsd: 2.5,
      depositUsd: 40.0,
      isAvailable: true,
      specifications: [
        "18 Ports Total",
        "98W Host Charging",
        "2.5 Gigabit Ethernet",
      ],
    },
  ];

  const filtered =
    category && category !== "ALL"
      ? inventory.filter((item) => item.category === category)
      : inventory;

  return NextResponse.json({
    success: true,
    venueId,
    totalItems: filtered.length,
    availableCount: filtered.filter((i) => i.isAvailable).length,
    inventory: filtered,
  });
}
