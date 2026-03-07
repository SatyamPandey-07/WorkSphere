import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 1. Get User Details with full inclusions
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                bookings: {
                    take: 10,
                    orderBy: { createdAt: "desc" },
                    include: {
                        venue: {
                            select: { name: true, category: true, address: true }
                        }
                    }
                },
                favorites: {
                    take: 10,
                    include: {
                        venue: {
                            select: { name: true, category: true }
                        }
                    }
                },
                ratings: {
                    take: 10,
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

        // 2. Format User-Centric Analytics
        return NextResponse.json({
            profile: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                joinedAt: user.createdAt
            },
            summary: {
                totalResidencies: user._count.bookings,
                totalFavorites: user._count.favorites,
                totalRatings: user._count.ratings,
                totalConversations: user._count.conversations
            },
            history: {
                bookings: user.bookings,
                favorites: user.favorites,
                ratings: user.ratings
            },
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Personalized Analytics API Error:", error);
        return NextResponse.json({ error: "Failed to fetch neural profile" }, { status: 500 });
    }
}
