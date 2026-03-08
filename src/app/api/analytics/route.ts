import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth";

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
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Personalized Analytics API Error:", error);
        return NextResponse.json({ error: "Failed to fetch neural profile" }, { status: 500 });
    }
}
