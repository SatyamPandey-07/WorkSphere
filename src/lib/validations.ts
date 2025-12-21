import { z } from "zod";

// Chat API schemas
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(10000),
});

export const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  conversationId: z.string().optional(),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
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
});

export const venueRatingSchema = z.object({
  wifiQuality: z.number().min(1).max(5),
  hasOutlets: z.boolean(),
  noiseLevel: z.enum(["quiet", "moderate", "loud"]),
  comment: z.string().max(1000).optional(),
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

// Location schema
export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// Export types
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type VenueSearch = z.infer<typeof venueSearchSchema>;
export type VenueCreate = z.infer<typeof venueCreateSchema>;
export type VenueRating = z.infer<typeof venueRatingSchema>;
export type ConversationCreate = z.infer<typeof conversationCreateSchema>;
export type MessageCreate = z.infer<typeof messageCreateSchema>;
export type Favorite = z.infer<typeof favoriteSchema>;
export type Location = z.infer<typeof locationSchema>;

// Validation helper
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): { 
  success: true; 
  data: T; 
} | { 
  success: false; 
  error: string; 
} {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { 
    success: false, 
    error: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
  };
}
