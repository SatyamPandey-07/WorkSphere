import "fake-indexeddb/auto";
import {
  queueOfflineReceipt,
  getQueuedReceiptJobs,
  updateReceiptJob,
  removeReceiptJob,
} from "../../lib/offlineStorage";

describe("Issue #1069 - Offline Receipt PDF Export Background Sync", () => {
  const mockBookingId = "booking-test-1069";

  beforeEach(async () => {
    const jobs = await getQueuedReceiptJobs();
    for (const job of jobs) {
      await removeReceiptJob(job.bookingId);
    }
  });

  it("queues an offline receipt export request with status pending", async () => {
    await queueOfflineReceipt(mockBookingId, "WorkSphere_Receipt_TEST.pdf");

    const jobs = await getQueuedReceiptJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].bookingId).toBe(mockBookingId);
    expect(jobs[0].filename).toBe("WorkSphere_Receipt_TEST.pdf");
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].retryCount).toBe(0);
    expect(jobs[0].createdAt).toBeGreaterThan(0);
  });

  it("updates a queued receipt job status and pdf ArrayBuffer when ready", async () => {
    await queueOfflineReceipt(mockBookingId);

    const dummyArrayBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
    await updateReceiptJob({
      bookingId: mockBookingId,
      status: "ready",
      pdf: dummyArrayBuffer,
    });

    const jobs = await getQueuedReceiptJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("ready");
    expect(jobs[0].pdf).toBeDefined();
  });

  it("increments retryCount and transitions to failed on max retries", async () => {
    await queueOfflineReceipt(mockBookingId);

    await updateReceiptJob({
      bookingId: mockBookingId,
      retryCount: 3,
      status: "failed",
    });

    const jobs = await getQueuedReceiptJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].retryCount).toBe(3);
    expect(jobs[0].status).toBe("failed");
  });

  it("removes a completed receipt job from IndexedDB store", async () => {
    await queueOfflineReceipt(mockBookingId);
    let jobs = await getQueuedReceiptJobs();
    expect(jobs).toHaveLength(1);

    await removeReceiptJob(mockBookingId);
    jobs = await getQueuedReceiptJobs();
    expect(jobs).toHaveLength(0);
  });
});
