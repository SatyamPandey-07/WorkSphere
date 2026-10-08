import {
  BatchStudentZkpWorkerPool,
  getBatchZkpWorkerPool,
  generateBatchStudentProofs,
  type BatchStudentProofItem,
} from "@/lib/zkp/batch";

describe("BatchStudentZkpWorkerPool (#5067)", () => {
  const sampleItems: BatchStudentProofItem[] = [
    {
      id: "student-1",
      secret: "123456",
      epoch: 2026,
      root: "1000",
      pathElements: ["10", "20", "30"],
      pathIndices: [0, 1, 0],
    },
    {
      id: "student-2",
      secret: "234567",
      epoch: 2026,
      root: "1000",
      pathElements: ["40", "50", "60"],
      pathIndices: [1, 0, 1],
    },
    {
      id: "student-3",
      secret: "345678",
      epoch: 2026,
      root: "1000",
      pathElements: ["70", "80", "90"],
      pathIndices: [0, 0, 1],
    },
    {
      id: "student-4",
      secret: "456789",
      epoch: 2026,
      root: "1000",
      pathElements: ["11", "22", "33"],
      pathIndices: [1, 1, 0],
    },
  ];

  afterEach(() => {
    const pool = getBatchZkpWorkerPool();
    pool.terminate();
  });

  it("initializes pool size matching CPU threads or custom concurrency", () => {
    const pool = new BatchStudentZkpWorkerPool({ poolSize: 4 });
    expect(pool.getPoolSize()).toBe(4);

    pool.setPoolSize(8);
    expect(pool.getPoolSize()).toBe(8);
  });

  it("handles empty batch input gracefully", async () => {
    const pool = new BatchStudentZkpWorkerPool({ poolSize: 2 });
    const result = await pool.generateBatch([]);

    expect(result.success).toBe(true);
    expect(result.totalCount).toBe(0);
    expect(result.completedCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("distributes and processes batch proofs concurrently", async () => {
    const pool = new BatchStudentZkpWorkerPool({ poolSize: 4 });
    let progressCalls = 0;

    const result = await pool.generateBatch(sampleItems, {
      onProgress: (completed, total) => {
        progressCalls++;
        expect(total).toBe(sampleItems.length);
        expect(completed).toBeGreaterThan(0);
      },
    });

    expect(result.totalCount).toBe(4);
    expect(result.completedCount + result.failedCount).toBe(4);
    expect(result.concurrency).toBe(4);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.proofsPerSecond).toBeGreaterThanOrEqual(0);
  });

  it("tracks throughput metrics across batches", async () => {
    const pool = new BatchStudentZkpWorkerPool({ poolSize: 2 });
    await pool.generateBatch(sampleItems.slice(0, 2));

    const metrics = pool.getMetrics();
    expect(metrics.poolSize).toBe(2);
    expect(metrics.totalBatchesProcessed).toBe(1);
  });

  it("provides helper generateBatchStudentProofs wrapper", async () => {
    const result = await generateBatchStudentProofs(sampleItems.slice(0, 2), {
      concurrency: 2,
    });

    expect(result.totalCount).toBe(2);
    expect(result.concurrency).toBe(2);
  });
});
