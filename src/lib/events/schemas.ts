import { z } from 'zod';

export const WebhookEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'DOCUMENT_SIGNED',
    'AI_WORKFLOW_COMPLETED',
    'MAP_GEOFENCE_BREACHED',
    'VENUE_CREATED',
    'REVIEW_SUBMITTED'
  ]),
  userId: z.string(),
  timestamp: z.string().datetime(),
  data: z.record(z.string(), z.any()),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
