/**
 * route.ts
 * /api/social/skill-exchange
 * Retrieves and posts on-site nomad skill barter listings.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  findComplementaryBarters,
  type SkillListing,
  type SkillCategory,
} from "@/lib/social/skillBarterEngine";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const venueId = searchParams.get("venueId") || "venue-sf-01";
  const category = searchParams.get("category");

  const mockListings: SkillListing[] = [
    {
      id: "listing-1",
      venueId,
      venueName: "Mission Focus Coworking & Cafe",
      userId: "usr-alex",
      userName: "Alex Chen",
      userTitle: "Senior Next.js & WebAssembly Dev",
      offeringSkill: "React 19 & Circom ZK Circuit Architecture",
      offeringCategory: "CODE_DEV",
      seekingSkill: "Schengen Visa & Portuguese NIF Tax Guidance",
      seekingCategory: "LEGAL_VISA",
      durationMinutes: 30,
      meetupSpot: "Lounge Table #4 (Near Pour-Over Bar)",
      status: "OPEN",
      reputationScore: 98,
      createdAt: new Date(Date.now() - 40 * 60000).toISOString(),
    },
    {
      id: "listing-2",
      venueId,
      venueName: "Mission Focus Coworking & Cafe",
      userId: "usr-maria",
      userName: "Maria Santos",
      userTitle: "Digital Nomad Immigration Consultant",
      offeringSkill: "Spanish DNV & Portugal Digital Nomad Visa Setup",
      offeringCategory: "LEGAL_VISA",
      seekingSkill: "TypeScript Code Review & API Performance Audit",
      seekingCategory: "CODE_DEV",
      durationMinutes: 30,
      meetupSpot: "Outdoor Garden Terrace",
      status: "OPEN",
      reputationScore: 95,
      createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
    },
    {
      id: "listing-3",
      venueId,
      venueName: "Mission Focus Coworking & Cafe",
      userId: "usr-sam",
      userName: "Sam Rivera",
      userTitle: "Product Designer & Brand Strategist",
      offeringSkill: "Figma UI/UX Critique & Design System Review",
      offeringCategory: "DESIGN_UI",
      seekingSkill: "B2B SaaS Cold Outbound & GTM Strategy",
      seekingCategory: "GROWTH_MARKETING",
      durationMinutes: 15,
      meetupSpot: "Quiet Booth 2",
      status: "OPEN",
      reputationScore: 92,
      createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
    },
    {
      id: "listing-4",
      venueId,
      venueName: "Mission Focus Coworking & Cafe",
      userId: "usr-elena",
      userName: "Elena Rostova",
      userTitle: "Growth Lead & B2B Copywriter",
      offeringSkill: "Landing Page Conversion & Cold Email Teardown",
      offeringCategory: "GROWTH_MARKETING",
      seekingSkill: "Design System & Figma Component Architecture",
      seekingCategory: "DESIGN_UI",
      durationMinutes: 15,
      meetupSpot: "Coffee Counter Island",
      status: "OPEN",
      reputationScore: 96,
      createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
    },
  ];

  const filtered =
    category && category !== "ALL"
      ? mockListings.filter(
          (l) =>
            l.offeringCategory === category || l.seekingCategory === category,
        )
      : mockListings;

  const matches = findComplementaryBarters(filtered);

  return NextResponse.json({
    success: true,
    venueId,
    totalListings: filtered.length,
    matches,
    listings: filtered,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      venueId = "venue-sf-01",
      venueName = "Mission Focus Coworking & Cafe",
      userId = "user_nomad_self",
      userName = "You",
      userTitle = "Digital Nomad Specialist",
      offeringSkill,
      offeringCategory = "CODE_DEV",
      seekingSkill,
      seekingCategory = "DESIGN_UI",
      durationMinutes = 30,
      meetupSpot = "Lounge Coffee Table",
    } = body;

    if (!offeringSkill || !seekingSkill) {
      return NextResponse.json(
        { error: "Both offeringSkill and seekingSkill are required" },
        { status: 400 },
      );
    }

    const newListing: SkillListing = {
      id: `listing-${Date.now()}`,
      venueId,
      venueName,
      userId,
      userName,
      userTitle,
      offeringSkill,
      offeringCategory: offeringCategory as SkillCategory,
      seekingSkill,
      seekingCategory: seekingCategory as SkillCategory,
      durationMinutes: durationMinutes as 15 | 30 | 45,
      meetupSpot,
      status: "OPEN",
      reputationScore: 100,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      message: "Skill Barter listing posted to venue notice board!",
      listing: newListing,
    });
  } catch (error: any) {
    console.error("[POST /api/social/skill-exchange] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to create skill barter listing",
        details: error.message,
      },
      { status: 500 },
    );
  }
}
