import { Redis } from "@upstash/redis";
import {
  generateTaxExportPdf,
  generateReceiptPdf,
} from "@/lib/pdfGenerator";
import { updateJobStatus, getJobStatus } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import {
  resolveDateRange,
  filterBookingsByRange,
} from "@/lib/taxExport";
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

const JOB_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
const THROTTLE_MS = 500;
const RECOVERY_INTERVAL_MS = 60_000;
const STALE_TIMEOUT_MS = 5 * 60 * 1000;

let activeJobId: string | null = null;
let activeJobStartTime = 0;
let lastRecoveryTime = 0;

/**
 * Upload a PDF buffer to Cloudinary.
 */
async function uploadToCloudinary(
  buffer: Uint8Array,
  filename: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: filename,
        format: "pdf",
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result?.secure_url) {
          reject(new Error("Cloudinary upload completed without a secure URL"));
          return;
        }

        resolve(result.secure_url);
      },
    );

    stream.on("error", reject);
    stream.end(Buffer.from(buffer));
  });
}

/**
 * Check whether the job has already been failed/recovered.
 *
 * This prevents a long-running processJob() from changing a timed-out
 * job back to COMPLETED.
 */
async function ensureJobStillActive(jobId: string): Promise<void> {
  const state = await getJobStatus(jobId);

  if (!state) {
    throw new Error(`Job ${jobId} no longer exists`);
  }

  if (state.status !== "PROCESSING") {
    throw new Error(
      `Job ${jobId} is no longer processing (current status: ${state.status})`,
    );
  }
}

/**
 * Process a single PDF job.
 */
async function processJob(jobStr: string): Promise<void> {
  const job = JSON.parse(jobStr);

  const { id, type, userId, data } = job;

  console.log(`Processing job ${id}...`);

  try {
    await updateJobStatus(id, {
      status: "PROCESSING",
    });

    let pdfBytes: Uint8Array;
    let filename: string;
    let userEmail = "user@example.com";

    /*
     * Get the user.
     */
    const user = await (prisma as any).user.findUnique({
      where: {
        id: userId,
      },
    });

    if (user?.email) {
      userEmail = user.email;
    }

    /*
     * TAX EXPORT
     */
    if (type === "TAX_EXPORT") {
      let bookings;

      if (
        Array.isArray(data?.bookingIds) &&
        data.bookingIds.length > 0
      ) {
        bookings = await (prisma as any).booking.findMany({
          where: {
            id: {
              in: data.bookingIds,
            },
            userId,
          },
          include: {
            venue: true,
            user: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      } else {
        const range = resolveDateRange({
          taxYear: data?.taxYear,
          startDate: data?.startDate,
          endDate: data?.endDate,
        });

        const allUserBookings = await (
          prisma as any
        ).booking.findMany({
          where: {
            userId,
          },
          include: {
            venue: true,
            user: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        bookings = filterBookingsByRange(
          allUserBookings,
          range,
        );
      }

      if (!bookings || bookings.length === 0) {
        throw new Error("No matching bookings found");
      }

      /*
       * Before expensive PDF generation, make sure the job
       * has not already been failed/recovered.
       */
      await ensureJobStillActive(id);

      pdfBytes = await generateTaxExportPdf(bookings);

      filename = `WorkSphere_Tax_Export_${Date.now()}`;
    }

    /*
     * RECEIPT DOWNLOAD
     */
    else if (type === "RECEIPT_DOWNLOAD") {
      if (!data?.bookingId) {
        throw new Error("Booking ID is required");
      }

      const booking = await (
        prisma as any
      ).booking.findFirst({
        where: {
          id: data.bookingId,
          userId,
        },
        include: {
          venue: true,
          user: true,
        },
      });

      if (!booking) {
        throw new Error("Booking not found");
      }

      await ensureJobStillActive(id);

      pdfBytes = await generateReceiptPdf(booking);

      filename = `WorkSphere_Receipt_${
        booking.confirmationId || booking.id
      }`;
    }

    /*
     * UNKNOWN JOB
     */
    else {
      throw new Error(`Unknown job type: ${type}`);
    }

    /*
     * Make sure the job is still active before uploading.
     */
    await ensureJobStillActive(id);

    const url = await uploadToCloudinary(
      pdfBytes,
      filename,
    );

    /*
     * Make sure a timeout/recovery has not happened while
     * Cloudinary was processing the upload.
     */
    await ensureJobStillActive(id);

    await transporter.sendMail({
      from:
        process.env.EMAIL_FROM ||
        "noreply@worksphere.app",
      to: userEmail,
      subject: "Your WorkSphere PDF is Ready",
      text:
        `Your requested PDF (${filename}.pdf) ` +
        `has been generated and is ready for download:\n\n${url}`,
    });

    /*
     * IMPORTANT:
     * Check one final time before marking COMPLETED.
     *
     * This prevents a late-running process from changing
     * a timed-out/recovered job back to COMPLETED.
     */
    await ensureJobStillActive(id);

    await updateJobStatus(id, {
      status: "COMPLETED",
      resultUrl: url,
    });

    console.log(
      `Job ${id} completed successfully.`,
    );
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err
        : new Error(String(err));

    console.error(
      `Job ${id} failed:`,
      error,
    );

    /*
     * Only mark FAILED if the job is still PROCESSING.
     *
     * If the watchdog/timeout already changed its status,
     * don't overwrite that status.
     */
    try {
      const currentState = await getJobStatus(id);

      if (currentState?.status === "PROCESSING") {
        await updateJobStatus(id, {
          status: "FAILED",
          error: error.message,
        });
      } else {
        console.log(
          `Job ${id} is already ${currentState?.status}. ` +
            `Skipping FAILED update.`,
        );
      }
    } catch (statusError) {
      console.error(
        `[Worker] Failed to update status for job ${id}:`,
        statusError,
      );
    }

    /*
     * Re-throw so startWorker() knows that processJob()
     * failed.
     */
    throw error;
  }
}

/**
 * Recover jobs that have been stuck in the processing queue
 * for too long.
 */
async function recoverStaleJobs(): Promise<void> {
  try {
    const processingJobs = await redis.lrange(
      "pdf:jobs:processing",
      0,
      -1,
    );

    if (
      !processingJobs ||
      processingJobs.length === 0
    ) {
      return;
    }

    console.log(
      `[Watchdog] Checking ${processingJobs.length} ` +
        `processing jobs for stale state...`,
    );

    const now = Date.now();

    for (const jobStr of processingJobs) {
      if (!jobStr) {
        continue;
      }

      try {
        const job = JSON.parse(jobStr);

        if (!job?.id) {
          console.error(
            "[Watchdog] Invalid job found:",
            jobStr,
          );

          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );

          continue;
        }

        const state = await getJobStatus(job.id);

        /*
         * No state means this processing entry is orphaned.
         */
        if (!state) {
          console.log(
            `[Watchdog] Job state not found for ${job.id}. ` +
              `Removing from processing queue.`,
          );

          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );

          continue;
        }

        const createdAt = Number(state.createdAt);

        if (Number.isNaN(createdAt)) {
          console.error(
            `[Watchdog] Invalid createdAt for job ${job.id}`,
          );
          continue;
        }

        const age = now - createdAt;

        /*
         * Re-queue stale jobs.
         */
        if (
          (state.status === "PROCESSING" ||
            state.status === "QUEUED") &&
          age > STALE_TIMEOUT_MS
        ) {
          console.log(
            `[Watchdog] Job ${job.id} is stale ` +
              `(age: ${Math.round(age / 1000)}s). ` +
              `Re-queuing...`,
          );

          /*
           * Change the status BEFORE re-queueing.
           *
           * This helps prevent the old process from thinking
           * it is still allowed to complete the job.
           */
          await updateJobStatus(job.id, {
            status: "QUEUED",
          });

          await redis.lpush(
            "pdf:jobs",
            jobStr,
          );

          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );
        }

        /*
         * Remove jobs that already finished.
         */
        else if (
          state.status === "COMPLETED" ||
          state.status === "FAILED"
        ) {
          console.log(
            `[Watchdog] Job ${job.id} already finished ` +
              `with status ${state.status}. ` +
              `Removing from processing queue.`,
          );

          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );
        }
      } catch (err) {
        console.error(
          "[Watchdog] Error processing stale job recovery:",
          jobStr,
          err,
        );
      }
    }
  } catch (err) {
    console.error(
      "[Watchdog] Error recovering stale jobs:",
      err,
    );
  }
}

/**
 * Start the worker.
 */
async function startWorker(): Promise<void> {
  console.log("Starting PDF Worker...");

  /*
   * Recover jobs left behind by a previous worker instance.
   */
  await recoverStaleJobs();

  lastRecoveryTime = Date.now();

  while (true) {
    try {
      /*
       * Periodically run the watchdog.
       */
      if (
        Date.now() - lastRecoveryTime >
        RECOVERY_INTERVAL_MS
      ) {
        await recoverStaleJobs();
        lastRecoveryTime = Date.now();
      }

      /*
       * If a job is active, check whether its execution time
       * has exceeded the worker timeout.
       */
      if (activeJobId !== null) {
        const elapsed =
          Date.now() - activeJobStartTime;

        if (elapsed > JOB_TIMEOUT_MS) {
          const timedOutJobId = activeJobId;

          console.warn(
            `[Worker] Job ${timedOutJobId} timed out ` +
              `after ${elapsed}ms.`,
          );

          /*
           * Mark the job FAILED only if it is still processing.
           */
          try {
            const state =
              await getJobStatus(timedOutJobId);

            if (
              state?.status === "PROCESSING"
            ) {
              await updateJobStatus(
                timedOutJobId,
                {
                  status: "FAILED",
                  error:
                    "Worker job timeout exceeded",
                },
              );
            }
          } catch (timeoutStatusError) {
            console.error(
              `[Worker] Could not update timeout status ` +
                `for ${timedOutJobId}:`,
              timeoutStatusError,
            );
          }

          activeJobId = null;
          activeJobStartTime = 0;
        } else {
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              POLL_INTERVAL_MS,
            ),
          );

          continue;
        }
      }

      /*
       * Atomically move the next job from the queue to
       * the processing queue.
       */
      const jobStr = await redis.lmove(
        "pdf:jobs",
        "pdf:jobs:processing",
        "right",
        "left",
      );

      if (jobStr) {
        let job: any;

        try {
          job = JSON.parse(jobStr);
        } catch (parseError) {
          console.error(
            "[Worker] Invalid job JSON:",
            jobStr,
            parseError,
          );

          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );

          continue;
        }

        if (!job?.id) {
          console.error(
            "[Worker] Job is missing an ID:",
            jobStr,
          );

          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );

          continue;
        }

        activeJobId = job.id;
        activeJobStartTime = Date.now();

        try {
          let timeoutId:
            | ReturnType<typeof setTimeout>
            | undefined;

          const timeoutPromise =
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                reject(
                  new Error(
                    "Worker job timeout exceeded",
                  ),
                );
              }, JOB_TIMEOUT_MS);
            });

          try {
            await Promise.race([
              processJob(jobStr as string),
              timeoutPromise,
            ]);
          } finally {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }
        } catch (err: unknown) {
          const failedId = activeJobId;

          const error =
            err instanceof Error
              ? err
              : new Error(String(err));

          if (failedId) {
            console.error(
              `[Worker] Job ${failedId} failed:`,
              error.message,
            );

            /*
             * processJob() normally handles its own FAILED
             * status. This is a safety net for timeout/errors
             * thrown outside processJob().
             */
            try {
              const state =
                await getJobStatus(failedId);

              if (
                state?.status === "PROCESSING"
              ) {
                await updateJobStatus(
                  failedId,
                  {
                    status: "FAILED",
                    error: error.message,
                  },
                );
              }
            } catch (statusError) {
              console.error(
                `[Worker] Failed to update job ${failedId}:`,
                statusError,
              );
            }
          }
        } finally {
          /*
           * Remove the job from the processing list.
           */
          await redis.lrem(
            "pdf:jobs:processing",
            1,
            jobStr,
          );

          activeJobId = null;
          activeJobStartTime = 0;

          /*
           * Small delay to prevent aggressive polling.
           */
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              THROTTLE_MS,
            ),
          );
        }
      } else {
        /*
         * No job available.
         */
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            POLL_INTERVAL_MS,
          ),
        );
      }
    } catch (err) {
      console.error(
        "[Worker] Poll error:",
        err,
      );

      activeJobId = null;
      activeJobStartTime = 0;

      /*
       * Wait before trying again after an unexpected
       * worker-level error.
       */
      await new Promise((resolve) =>
        setTimeout(resolve, 5_000),
      );
    }
  }
}

/*
 * Start the worker.
 */
startWorker().catch((err) => {
  console.error(
    "Fatal PDF Worker error:",
    err,
  );

  process.exit(1);
});
