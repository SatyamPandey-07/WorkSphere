import { z } from "zod";

// =========================================================================
// CORE SCHEMAS
// =========================================================================

// Chat API schemas
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(10000),
});

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  conversationId: z.string().optional().nullable(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional()
    .nullable(),
});

// Venue schemas
export const venueSearchSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(100).max(50000).default(5000),
  category: z.enum(["cafe", "coworking", "library", "all"]).optional(),
  wifi: z.coerce.boolean().optional(),
  outlets: z.coerce.boolean().optional(),
  quiet: z.coerce.boolean().optional(),
  ergonomic: z.coerce.boolean().optional(),
  outletDensity: z
    .enum(["every_table", "some_tables", "wall_seats", "none"])
    .optional(),
  wifiSpeedBand: z.enum(["basic", "fast", "ultra", "all"]).optional(),
  hasPhoneBooths: z.coerce.boolean().optional(),
  hasNoMusic: z.coerce.boolean().optional(),
  hasQuietZone: z.coerce.boolean().optional(),
  hasAncHeadsetRental: z.coerce.boolean().optional(),
  singleOriginBeans: z.coerce.boolean().optional(),
  specialtyEspresso: z.coerce.boolean().optional(),
  oatAlmondMilk: z.coerce.boolean().optional(),
  pourOverAvailable: z.coerce.boolean().optional(),
  lighting: z
    .enum(["natural_daylight", "warm_ambient", "fluorescent", "bright_white"])
    .optional(),
  petsAllowedIndoors: z.coerce.boolean().optional(),
  patioOnly: z.coerce.boolean().optional(),
  waterBowlsProvided: z.coerce.boolean().optional(),
  dogFriendly: z.coerce.boolean().optional(),
  catsAllowed: z.coerce.boolean().optional(),
  musicStyle: z.enum(["lofi", "classical_jazz", "no_music", "all"]).optional(),
  cities: z.string().optional(),
});

export const venueCreateSchema = z.object({
  name: z.string().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  category: z.enum(["cafe", "coworking", "library"]),
  address: z.string().max(500).optional(),
  wifiQuality: z.number().min(1).max(5).optional(),
  hasOutlets: z.boolean().optional(),
  noiseLevel: z.enum(["quiet", "moderate", "loud"]).optional(),
  hasErgonomic: z.boolean().optional(),
  singleOriginBeans: z.boolean().optional(),
  specialtyEspresso: z.boolean().optional(),
  oatAlmondMilk: z.boolean().optional(),
  pourOverAvailable: z.boolean().optional(),
  outletDensity: z
    .enum(["every_table", "some_tables", "wall_seats", "none"])
    .optional(),
  wifiSpeed: z.number().min(0).max(10000).optional(),
  hasPhoneBooths: z.boolean().optional(),
  hasNoMusic: z.boolean().optional(),
  hasQuietZone: z.boolean().optional(),
  hasAncHeadsetRental: z.boolean().optional(),
  lighting: z
    .enum(["natural_daylight", "warm_ambient", "fluorescent", "bright_white"])
    .optional(),
  petsAllowedIndoors: z.boolean().optional(),
  patioOnly: z.boolean().optional(),
  waterBowlsProvided: z.boolean().optional(),
  dogFriendly: z.boolean().optional(),
  catsAllowed: z.boolean().optional(),
  musicStyle: z.string().optional(),
});

export const venueRatingSchema = z.object({
  wifiQuality: z.number().min(1).max(5),
  hasOutlets: z.boolean(),
  powerTypes: z.array(z.string()).optional(),
  outletLocations: z.array(z.string()).optional(),
  noiseLevel: z.enum(["quiet", "moderate", "loud"]),
  comment: z.string().max(1000).optional(),
  hasErgonomic: z.boolean().optional().default(false),
  outletDensity: z
    .enum(["every_table", "some_tables", "wall_seats", "none"])
    .optional()
    .default("none"),
  wifiSpeed: z.number().min(0).max(10000).optional().nullable(),
  downloadSpeed: z.number().min(0).max(10000).optional().nullable(),
  uploadSpeed: z.number().min(0).max(10000).optional().nullable(),
  latency: z.number().min(0).max(1000).optional().nullable(),
  crowdLevel: z
    .enum(["empty", "moderate", "busy", "very busy"])
    .optional()
    .nullable(),
  speedtestPhoto: z.string().optional().nullable(),
  avgDecibels: z.number().min(20).max(130).optional().nullable(),
  peakDecibels: z.number().min(20).max(140).optional().nullable(),
  hasPhoneBooths: z.boolean().optional().default(false),
  hasNoMusic: z.boolean().optional().default(false),
  hasQuietZone: z.boolean().optional().default(false),
  singleOriginBeans: z.boolean().optional().default(false),
  specialtyEspresso: z.boolean().optional().default(false),
  oatAlmondMilk: z.boolean().optional().default(false),
  pourOverAvailable: z.boolean().optional().default(false),
  lighting: z
    .enum(["natural_daylight", "warm_ambient", "fluorescent", "bright_white"])
    .optional(),
  petsAllowedIndoors: z.boolean().optional().default(false),
  patioOnly: z.boolean().optional().default(false),
  waterBowlsProvided: z.boolean().optional().default(false),
  dogFriendly: z.boolean().optional().default(false),
  catsAllowed: z.boolean().optional().default(false),
  musicStyle: z.string().optional().nullable(),
});

// Conversation schemas
export const conversationCreateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export const messageCreateSchema = z.object({
  content: z.string().min(1).max(10000),
  role: z.enum(["user", "assistant"]).default("user"),
});

// Favorites schemas
export const favoriteSchema = z.object({
  venueId: z.string().min(1),
});

// Favorite notes schema
export const favoriteNotesSchema = z.object({
  notes: z.string().max(2000).nullable(),
});

// Favorite tag schemas
export const createFavoriteTagSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color"),
});

export const updateFavoriteTagSchema = z.object({
  name: z.string().min(1).max(50).trim().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
    .optional(),
});

export const syncFavoriteTagsSchema = z.object({
  updates: z
    .array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().min(1).max(50).trim().optional(),
          color: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color")
            .optional(),
        })
        .refine((u) => u.name !== undefined || u.color !== undefined, {
          message: "Each update must include name and/or color",
        }),
    )
    .min(1)
    .max(200),
});

// Location schema
export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Collection / Folder schemas
export const createFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(100, "Folder name must be 100 characters or less"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or less")
    .optional(),
  isPublic: z.boolean().optional(),
});

export const updateFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Folder name is required")
    .max(100, "Folder name must be 100 characters or less")
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, "Description must be 500 characters or less")
    .optional(),
  isPublic: z.boolean().optional(),
});

// =========================================================================
// TYPES & DYNAMIC VALIDATION PIPELINE INTERFACES
// =========================================================================
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type VenueSearch = z.infer<typeof venueSearchSchema>;
export type VenueCreate = z.infer<typeof venueCreateSchema>;
export type VenueRating = z.infer<typeof venueRatingSchema>;
export type ConversationCreate = z.infer<typeof conversationCreateSchema>;
export type MessageCreate = z.infer<typeof messageCreateSchema>;
export type Favorite = z.infer<typeof favoriteSchema>;
export type FavoriteNotes = z.infer<typeof favoriteNotesSchema>;
export type CreateFavoriteTag = z.infer<typeof createFavoriteTagSchema>;
export type UpdateFavoriteTag = z.infer<typeof updateFavoriteTagSchema>;
export type SyncFavoriteTags = z.infer<typeof syncFavoriteTagsSchema>;
export type Location = z.infer<typeof locationSchema>;
export type CreateFolder = z.infer<typeof createFolderSchema>;
export type UpdateFolder = z.infer<typeof updateFolderSchema>;

// XR Anchor schemas
export const xrAnchorCreateSchema = z.object({
  venueId: z.string().min(1),
  seatId: z.string().optional().nullable(),
  bookingId: z.string().optional().nullable(),
  anchorPersistId: z.string().uuid(),
  matrix: z.array(z.number()).length(16),
  label: z.string().max(200).optional(),
});

export const xrAnchorUpdateSchema = z.object({
  matrix: z.array(z.number()).length(16).optional(),
  label: z.string().max(200).optional().nullable(),
});

export const xrAnchorQuerySchema = z.object({
  venueId: z.string().min(1),
});

export type XRAnchorCreate = z.infer<typeof xrAnchorCreateSchema>;
export type XRAnchorUpdate = z.infer<typeof xrAnchorUpdateSchema>;
export type XRAnchorQuery = z.infer<typeof xrAnchorQuerySchema>;

// Validation helper
export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
):
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: string;
    } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    error: result.error.issues
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", "),
  };
}
