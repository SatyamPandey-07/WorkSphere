/**
 * Order Notification Worker
 * Runs in the background to schedule and dispatch push notifications
 * for order readiness, avoiding main thread blocking.
 */

export interface NotificationPayload {
  orderId: string;
  deskNumber: string;
  triggerAt: number; // Unix timestamp in ms
  message: string;
  type: 'READY' | 'DELAYED' | 'CANCELLED';
}

interface ScheduledNotification {
  id: string;
  payload: NotificationPayload;
  timeoutId: any; // NodeJS.Timeout or number
}

const scheduledNotifications = new Map<string, ScheduledNotification>();

self.addEventListener('message', (event: MessageEvent) => {
  const { action, data } = event.data;

  switch (action) {
    case 'SCHEDULE_NOTIFICATION':
      scheduleNotification(data as NotificationPayload);
      break;
    case 'CANCEL_NOTIFICATION':
      cancelNotification(data.orderId);
      break;
    case 'CLEAR_ALL':
      clearAllNotifications();
      break;
    default:
      console.warn('[NotificationWorker] Unknown action:', action);
  }
});

function scheduleNotification(payload: NotificationPayload) {
  const now = Date.now();
  const delay = Math.max(0, payload.triggerAt - now);

  // Cancel any existing notification for this order to prevent duplicates
  cancelNotification(payload.orderId);

  const timeoutId = setTimeout(() => {
    executeNotification(payload);
    scheduledNotifications.delete(payload.orderId);
  }, delay);

  scheduledNotifications.set(payload.orderId, {
    id: payload.orderId,
    payload,
    timeoutId
  });

  // Acknowledge scheduling to main thread
  self.postMessage({
    action: 'NOTIFICATION_SCHEDULED',
    orderId: payload.orderId,
    triggerAt: payload.triggerAt
  });
}

function cancelNotification(orderId: string) {
  const existing = scheduledNotifications.get(orderId);
  if (existing) {
    clearTimeout(existing.timeoutId);
    scheduledNotifications.delete(orderId);
    
    self.postMessage({
      action: 'NOTIFICATION_CANCELLED',
      orderId
    });
  }
}

function clearAllNotifications() {
  for (const [id, notification] of scheduledNotifications.entries()) {
    clearTimeout(notification.timeoutId);
  }
  scheduledNotifications.clear();
  
  self.postMessage({ action: 'ALL_CLEARED' });
}

function executeNotification(payload: NotificationPayload) {
  // In a real browser environment, this would trigger the Notification API
  // or communicate with a Service Worker for background push.
  // Here we post back to the main thread to handle UI toast or API call.
  
  self.postMessage({
    action: 'TRIGGER_NOTIFICATION',
    payload
  });

  // Log for debugging in worker context
  console.log(`[NotificationWorker] Triggered ${payload.type} for Order ${payload.orderId} at Desk ${payload.deskNumber}`);
}

// Handle worker termination gracefully
self.addEventListener('unload', () => {
  clearAllNotifications();
});

export {};
