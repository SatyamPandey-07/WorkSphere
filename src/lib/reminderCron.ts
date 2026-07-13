import { prisma } from './prisma';

export async function sendEmailAlert(options: { to: string; subject: string; body: string }) {
  console.log(`[sendEmailAlert mock] Sending email to: ${options.to}, subject: ${options.subject}`);
}

export async function sendWebPushNotification(subscription: any, payload: any) {
  console.log(`[sendWebPushNotification mock] Sending push notification with body: ${payload.body}`);
}

/**
 * Sweeps the reservation collection to catch users whose slots launch in 30 minutes
 */
export async function processUpcomingReservationAlerts() {
  const targetTime = new Date(Date.now() + 30 * 60 * 1000); // Exactly 30 minutes out
  
  // Create upper and lower matching bounds to capture records safely within a 1-minute window
  const windowStart = new Date(targetTime.setSeconds(0, 0));
  const windowEnd = new Date(targetTime.setSeconds(59, 999));

  try {
    const upcomingBookings = await prisma.booking.findMany({
      where: {
        // Since schema has startTime as a DateTime/Date, we check if it lies in this window
        // Note: adjust property name if booking schema uses a different field name
        date: {
          gte: windowStart.toISOString().split('T')[0],
        },
        alertSent: false,
      } as any,
      include: {
        user: true,
        venue: true,
      },
    });

    for (const booking of upcomingBookings) {
      // 1. Dispatch Transactional Email Alert Structure
      if (booking.user.email) {
        await sendEmailAlert({
          to: booking.user.email,
          subject: `Reminder: Your hot-desk at ${booking.venue.name} starts in 30 minutes!`,
          body: `Hi ${booking.user.firstName || 'Nomad'},\n\nThis is a quick reminder that your reserved space at ${booking.venue.name} begins soon.`,
        });
      }

      // 2. Broadcast Desktop/Mobile Web Push Notification
      if ((booking.user as any).pushSubscription) {
        await sendWebPushNotification((booking.user as any).pushSubscription, {
          title: 'Upcoming Reservation Alert 🖥️',
          body: `Your desk at ${booking.venue.name} is ready in 30 minutes. See you soon!`,
          icon: '/icons/icon-192x192.png',
        });
      }

      // 3. Mark alert as executed to protect against duplicate broadcasts
      await prisma.booking.update({
        where: { id: booking.id },
        data: { alertSent: true } as any,
      });
    }
  } catch (error) {
    console.error('Failed running reservation notification worker sequence:', error);
  }
}
