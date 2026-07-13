import prisma from './db';
import { sendEmailAlert } from './mailer';
import { sendWebPushNotification } from './pushNotifications';

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
        startTime: {
          gte: windowStart,
          lte: windowEnd,
        },
        alertSent: false,
      },
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
          body: `Hi ${booking.user.name},\n\nThis is a quick reminder that your reserved space at ${booking.venue.name} begins at ${booking.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        });
      }

      // 2. Broadcast Desktop/Mobile Web Push Notification
      if (booking.user.pushSubscription) {
        await sendWebPushNotification(booking.user.pushSubscription, {
          title: 'Upcoming Reservation Alert 🖥️',
          body: `Your desk at ${booking.venue.name} is ready in 30 minutes. See you soon!`,
          icon: '/icons/icon-192x192.png',
        });
      }

      // 3. Mark alert as executed to protect against duplicate broadcasts
      await prisma.booking.update({
        where: { id: booking.id },
        data: { alertSent: true },
      });
    }
  } catch (error) {
    console.error('Failed running reservation notification worker sequence:', error);
  }
}
