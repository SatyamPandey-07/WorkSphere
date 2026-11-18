import { z } from 'zod';

export const VenueFlagReasonEnum = z.enum([
  'closed',
  'incorrect_info',
  'loud_noise',
  'wifi_broken',
  'other',
]);

export type VenueFlagReason = z.infer<typeof VenueFlagReasonEnum>;

/**
 * Strips HTML/script tags and encodes unsafe HTML entities to neutralize XSS payloads.
 */
export function sanitizeVenueFlagDetails(input: string): string {
  if (typeof input !== 'string') return '';

  // Remove script/style blocks completely first
  let sanitized = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Strip all HTML tags (both closed and unclosed)
  sanitized = sanitized.replace(/<[^>]*>?/gm, '');

  // Neutralize inline event handlers and javascript: protocols
  sanitized = sanitized
    .replace(/javascript\s*:/gi, '')
    .replace(/\bon\w+\s*=/gi, '');

  // Escape any remaining angle brackets or quotes
  sanitized = sanitized
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return sanitized.trim();
}

export const venueFlagSchema = z.object({
  reason: VenueFlagReasonEnum,
  details: z
    .string()
    .transform((val) => sanitizeVenueFlagDetails(val))
    .pipe(
      z
        .string()
        .min(10, 'Details must be at least 10 characters long.')
        .max(500, 'Details cannot exceed 500 characters.'),
    ),
});

export type VenueFlagInput = z.infer<typeof venueFlagSchema>;
