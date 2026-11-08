/**
 * Venue Review & Rating Data Access Repository.
 *
 * Encapsulates all Prisma database queries for venue ratings, reviews,
 * and venue aggregate persistence with concurrency & retry handling.
 */

import { prisma as defaultPrisma } from "@/lib/prisma";

export class VenueReviewRepository {
  constructor(private prisma: typeof defaultPrisma = defaultPrisma) {}

  /**
   * Finds a venue rating by ID.
   */
  async findRatingById(id: string) {
    return this.prisma.venueRating.findUnique({
      where: { id },
    });
  }

  /**
   * Finds an existing rating for a specific user and venue.
   */
  async findUserVenueRating(userId: string, venueId: string) {
    return this.prisma.venueRating.findUnique({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
    });
  }

  /**
   * Fetches all ratings for a given venue.
   */
  async findVenueRatings(
    venueId: string,
    options?: {
      includeUser?: boolean;
      orderBy?: any;
    },
  ) {
    return this.prisma.venueRating.findMany({
      where: { venueId },
      include: options?.includeUser
        ? {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          }
        : undefined,
      orderBy: options?.orderBy ?? { createdAt: "desc" },
    });
  }

  /**
   * Upserts a venue rating within a transaction with exponential retry & key collision recovery.
   */
  async upsertRating(params: {
    userId: string;
    venueId: string;
    update: any;
    create: any;
  }) {
    const { userId, venueId, update, create } = params;
    let retries = 0;

    while (retries < 3) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          return tx.venueRating.upsert({
            where: {
              userId_venueId: {
                userId,
                venueId,
              },
            },
            update,
            create,
          });
        });
      } catch (err: any) {
        retries++;
        if (err?.code === "P2002" || err?.code === "P2034") {
          try {
            return await this.prisma.$transaction(async (tx) => {
              return tx.venueRating.update({
                where: {
                  userId_venueId: {
                    userId,
                    venueId,
                  },
                },
                data: update,
              });
            });
          } catch {
            if (retries >= 3) throw err;
            await new Promise((res) => setTimeout(res, 50 * retries));
          }
        } else {
          throw err;
        }
      }
    }

    return await this.prisma.venueRating.findUniqueOrThrow({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
    });
  }

  /**
   * Updates an existing rating.
   */
  async updateRating(userId: string, venueId: string, data: any) {
    return this.prisma.venueRating.update({
      where: {
        userId_venueId: {
          userId,
          venueId,
        },
      },
      data,
    });
  }

  /**
   * Updates aggregated metrics on the venue record.
   */
  async updateVenueAggregates(venueId: string, data: any) {
    return this.prisma.venue.update({
      where: { id: venueId },
      data,
    });
  }

  /**
   * Finds a venue by id or placeId.
   */
  async findVenue(venueId: string) {
    return this.prisma.venue.findFirst({
      where: {
        OR: [{ id: venueId }, { placeId: venueId }],
      },
    });
  }
}

export const defaultVenueReviewRepository = new VenueReviewRepository();
