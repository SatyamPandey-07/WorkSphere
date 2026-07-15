import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";
import { calculateLevel } from "@/lib/gamification";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 0. Ensure Identity 💎
        await ensureUserExists(userId);

        // 1. Get User Details with full inclusions
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                bookings: {
                    take: 10,
                    orderBy: { createdAt: "desc" },
                    include: {
                        venue: {
                            select: { 
                                name: true, 
                                category: true, 
                                address: true,
                                latitude: true,
                                longitude: true
                            }
                        }
                    }
                },
                favorites: {
                    take: 10,
                    orderBy: { createdAt: "desc" },
                    include: {
                        venue: {
                            select: { name: true, category: true }
                        }
                    }
                },
                ratings: {
                    take: 10,
                    orderBy: { createdAt: "desc" },
                    include: {
                        venue: {
                            select: { name: true }
                        }
                    }
                },
                _count: {
                    select: {
                        bookings: true,
                        favorites: true,
                        ratings: true,
                        conversations: true
                    }
                }
            }
        });

        if (!user) {
            return NextResponse.json({ error: "User not found in neural ledger" }, { status: 404 });
        }

        const u = user as any;

        // 1.5. Calculate Gamification Data
        // A. Fetch all ratings to determine night reviews and speedtests
        const allRatings = await prisma.venueRating.findMany({
            where: { userId },
            select: {
                createdAt: true,
                wifiSpeed: true,
            }
        });

        // B. Fetch all unique cafe bookings
        const cafeBookings = await prisma.booking.findMany({
            where: {
                userId,
                status: "CONFIRMED",
                venue: {
                    category: "cafe"
                }
            },
            select: {
                venueId: true
            }
        });
        const uniqueCafesBooked = new Set(cafeBookings.map(b => b.venueId)).size;

        // C. Fetch count of venues added
        const venuesAddedCount = await prisma.venue.count({
            where: { creatorId: userId }
        });

        const reviewsCount = allRatings.length;
        const speedtestsCount = allRatings.filter(r => r.wifiSpeed !== null && r.wifiSpeed > 0).length;
        
        const nightOwlReviewsCount = allRatings.filter(r => {
            const hours = new Date(r.createdAt).getHours();
            return hours >= 21 || hours < 5;
        }).length;

        // XP Breakdown:
        // - 50 XP per Review (rating)
        // - 100 XP per Venue added
        // - 100 XP per Speedtest uploaded
        const totalXp = (reviewsCount * 50) + (venuesAddedCount * 100) + (speedtestsCount * 100);

        const lvlInfo = calculateLevel(totalXp);

        const badges = [
            {
                id: "wifi_scout",
                name: "WiFi Scout",
                description: "Verified 3+ venue speedtests.",
                earned: speedtestsCount >= 3,
                progress: Math.min(speedtestsCount, 3),
                target: 3,
                icon: "wifi"
            },
            {
                id: "cafe_nomad",
                name: "Cafe Nomad",
                description: "Checked in/booked at 5 different cafes.",
                earned: uniqueCafesBooked >= 5,
                progress: Math.min(uniqueCafesBooked, 5),
                target: 5,
                icon: "cafe"
            },
            {
                id: "night_owl",
                name: "Night Owl",
                description: "Left reviews at venues after 9 PM.",
                earned: nightOwlReviewsCount >= 1,
                progress: Math.min(nightOwlReviewsCount, 1),
                target: 1,
                icon: "moon"
            }
        ];

        // 2. Format User-Centric Analytics
        return NextResponse.json({
            profile: {
                id: u.id,
                email: u.email,
                firstName: u.firstName,
                lastName: u.lastName,
                joinedAt: u.createdAt
            },
            summary: {
                totalResidencies: u._count?.bookings || 0,
                totalFavorites: u._count?.favorites || 0,
                totalRatings: u._count?.ratings || 0,
                totalConversations: u._count?.conversations || 0
            },
            history: {
                bookings: u.bookings || [],
                favorites: u.favorites || [],
                ratings: u.ratings || []
            },
            gamification: {
                level: lvlInfo.level,
                xp: lvlInfo.xp,
                xpInCurrentLevel: lvlInfo.xpInCurrentLevel,
                xpForNextLevel: lvlInfo.xpForNextLevel,
                progressPercent: lvlInfo.progressPercent,
                xpBreakdown: {
                    reviewsXp: reviewsCount * 50,
                    venuesXp: venuesAddedCount * 100,
                    speedtestsXp: speedtestsCount * 100
                },
                stats: {
                    reviewsCount,
                    venuesAddedCount,
                    speedtestsCount,
                    uniqueCafesBooked,
                    nightOwlReviewsCount
                },
                badges
            },
            timestamp: Date.now()
        });
    } catch (error: any) {
        console.error("Personalized Analytics API Error:", error);
        const errorMessage = process.env.NODE_ENV !== "production"
            ? `${error.message || error}`
            : "Failed to fetch neural profile";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
