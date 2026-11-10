import { z } from 'zod';

export const VenueFlagReasonEnum = z.enum([
  'closed',
  'incorrect_info',
  'loud_noise',
  'wifi_broken',
  'other',
]);

export const venueFlagSchema = z.object({
  reason: VenueFlagReasonEnum,
  details: z
    .string()
    .min(10, 'Details must be at least 10 characters long.')
    .max(500, 'Details cannot exceed 500 characters.')
    .transform((val) => val.trim().replace(/<[^>]*>?/gm, '')), // Basic HTML tag sanitization
});

export type VenueFlagInput = z.infer<typeof venueFlagSchema>;