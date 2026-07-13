import { prisma } from './prisma';
import { Redis } from '@upstash/redis';
import nodemailer from 'nodemailer';

const redis = Redis.fromEnv();

async function sendEmailAlert(booking: any) {
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  
  if (!SMTP_USER || !SMTP_PASS || !booking.customerEmail) {
    console.log(`[Reminder Notification Skip] SMTP credentials or recipient email missing for booking ${booking.id}`);
    return;
  }
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
  
  const googleMapsLink = `https://www.google.com/maps/dir/?api=1&destination=${booking.venue.latitude},${booking.venue.longitude}`;
  const workSphereLink = `https://work-sphere-one.vercel.app/ai?venue=${booking.venue.id}`;

  await transporter.sendMail({
    from: `"WorkSphere Concierge" <${SMTP_USER}>`,
    to: booking.customerEmail,
    subject: `Reminder: Your hot-desk at ${booking.venue.name} starts in 30 minutes!`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2>Hi ${booking.user?.firstName || 'Nomad'},</h2>
        <p>This is a quick reminder that your reserved workspace at <strong>${booking.venue.name}</strong> starts in 30 minutes (at ${booking.time})!</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <h3>Reservation Details:</h3>
        <ul>
          <li><strong>Venue:</strong> ${booking.venue.name}</li>
          <li><strong>Address:</strong> ${booking.venue.address || "No address provided"}</li>
          <li><strong>Time:</strong> ${booking.time}</li>
        </ul>
        <p>
          <a href="${workSphereLink}" style="display: inline-block; background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px;">View Reservation</a>
          <a href="${googleMapsLink}" style="display: inline-block; background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">Get Directions</a>
        </p>
      </div>
    `,
  });
  console.log(`[Reminder Notification Success] Email sent to ${booking.customerEmail} for booking ${booking.id}`);
}

/**
 * Sweeps the reservation collection to catch users whose slots launch in 30 minutes
 */
export async function processUpcomingReservationAlerts() {
  try {
    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    const bookings = await prisma.booking.findMany({
      where: {
        date: todayStr,
        status: 'CONFIRMED',
      },
      include: {
        user: true,
        venue: true,
      },
    });

    const now = new Date();
    const targetMin = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins window start
    const targetMax = new Date(now.getTime() + 45 * 60 * 1000); // 45 mins window end

    for (const booking of bookings) {
      try {
        const bookingTimeStr = booking.time; // e.g. "10:00 AM"
        const bookingDateTime = new Date(`${booking.date} ${bookingTimeStr}`);
        
        if (isNaN(bookingDateTime.getTime())) continue;
        
        if (bookingDateTime >= targetMin && bookingDateTime <= targetMax) {
          const redisKey = `booking-reminder:${booking.id}`;
          const alreadySent = await redis.get(redisKey);
          if (alreadySent) continue;
          
          await sendEmailAlert(booking);
          await redis.set(redisKey, "sent", { ex: 7200 }); // 2 hours expiry
        }
      } catch (err) {
        console.error(`Error processing booking reminder for ${booking.id}:`, err);
      }
    }
  } catch (error) {
    console.error('Failed running reservation notification worker sequence:', error);
  }
}
