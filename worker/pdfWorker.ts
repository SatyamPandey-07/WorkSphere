import { Redis } from "@upstash/redis";
import { generateTaxExportPdf, generateReceiptPdf } from "@/lib/pdfGenerator";
import { updateJobStatus } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { resolveDateRange, filterBookingsByRange } from "@/lib/taxExport";
import { v2 as cloudinary } from "cloudinary";
import nodemailer from "nodemailer";

const redis = Redis.fromEnv();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SERVER_HOST,
  port: Number(process.env.EMAIL_SERVER_PORT) || 587,
  auth: {
    user: process.env.EMAIL_SERVER_USER,
    pass: process.env.EMAIL_SERVER_PASSWORD,
  },
});

async function uploadToCloudinary(buffer: Uint8Array, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", public_id: filename, format: "pdf" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result?.secure_url as string);
      }
    );
    stream.end(Buffer.from(buffer));
  });
}

async function processJob(jobStr: string) {
  const job = JSON.parse(jobStr);
  const { id, type, userId, data } = job;
  console.log(`Processing job ${id}...`);

  try {
    await updateJobStatus(id, { status: "PROCESSING" });

    let pdfBytes: Uint8Array;
    let filename: string;
    let userEmail: string = "user@example.com"; // Default/Fallback

    const user = await (prisma as any).user.findUnique({ where: { id: userId } });
    if (user && user.email) {
      userEmail = user.email;
    }

    if (type === "TAX_EXPORT") {
      let bookings;
      if (Array.isArray(data.bookingIds) && data.bookingIds.length > 0) {
        bookings = await (prisma as any).booking.findMany({
          where: { id: { in: data.bookingIds }, userId },
          include: { venue: true, user: true },
          orderBy: { createdAt: "desc" },
        });
      } else {
        const range = resolveDateRange({ taxYear: data.taxYear, startDate: data.startDate, endDate: data.endDate });
        const allUserBookings = await (prisma as any).booking.findMany({
          where: { userId },
          include: { venue: true, user: true },
          orderBy: { createdAt: "desc" },
        });
        bookings = filterBookingsByRange(allUserBookings, range);
      }

      if (bookings.length === 0) {
        throw new Error("No matching bookings found");
      }

      pdfBytes = await generateTaxExportPdf(bookings);
      filename = `WorkSphere_Tax_Export_${Date.now()}`;
    } else if (type === "RECEIPT_DOWNLOAD") {
      const booking = await (prisma as any).booking.findFirst({
        where: { id: data.bookingId, userId },
        include: { venue: true, user: true },
      });
      if (!booking) throw new Error("Booking not found");

      pdfBytes = await generateReceiptPdf(booking);
      filename = `WorkSphere_Receipt_${booking.confirmationId || booking.id}`;
    } else {
      throw new Error(`Unknown job type: ${type}`);
    }

    // Upload
    const url = await uploadToCloudinary(pdfBytes, filename);

    // Notify
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || "noreply@worksphere.app",
      to: userEmail,
      subject: "Your WorkSphere PDF is Ready",
      text: `Your requested PDF (${filename}.pdf) has been generated and is ready for download:\n\n${url}`,
    });

    await updateJobStatus(id, { status: "COMPLETED", resultUrl: url });
    console.log(`Job ${id} completed successfully.`);
  } catch (err: any) {
    console.error(`Job ${id} failed:`, err);
    await updateJobStatus(id, { status: "FAILED", error: err.message });
  }
}

async function startWorker() {
  console.log("Starting PDF Worker...");
  while (true) {
    try {
      const jobStr = await redis.rpop("pdf:jobs");
      if (jobStr) {
        await processJob(jobStr as string);
      } else {
        // Sleep if no jobs
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (err) {
      console.error("Worker poll error:", err);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

startWorker();
