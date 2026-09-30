/**
 * Tests for venue booking data pipeline processing.
 */

interface PipelineStage {
  stageId: string;
  name: string;
  inputRecords: number;
  outputRecords: number;
  errorRecords: number;
  processingMs: number;
  status: "pending" | "running" | "completed" | "failed";
}

function stageThroughput(stage: PipelineStage): number {
  if (stage.processingMs === 0) return 0;
  return Math.round((stage.outputRecords / (stage.processingMs / 1000)) * 10) / 10;
}

function stageSuccessRate(stage: PipelineStage): number {
  if (stage.inputRecords === 0) return 100;
  const processed = stage.inputRecords - stage.errorRecords;
  return Math.round((processed / stage.inputRecords) * 100);
}

function pipelineDataLoss(stages: PipelineStage[]): number {
  if (stages.length === 0 || stages[0].inputRecords === 0) return 0;
  const firstInput = stages[0].inputRecords;
  const lastOutput = stages[stages.length - 1].outputRecords;
  return Math.round(((firstInput - lastOutput) / firstInput) * 100);
}

function bottleneckStage(stages: PipelineStage[]): PipelineStage | null {
  const completed = stages.filter((s) => s.status === "completed" && s.inputRecords > 0);
  if (completed.length === 0) return null;
  return completed.reduce((slow, s) =>
    stageThroughput(s) < stageThroughput(slow) ? s : slow
  );
}

function pipelineStatus(stages: PipelineStage[]): "healthy" | "degraded" | "failed" | "idle" {
  if (stages.length === 0) return "idle";
  if (stages.some((s) => s.status === "failed")) return "failed";
  if (stages.some((s) => stageSuccessRate(s) < 95)) return "degraded";
  if (stages.every((s) => s.status === "completed")) return "healthy";
  return "degraded";
}

const STAGES: PipelineStage[] = [
  { stageId: "st1", name: "Ingestion",   inputRecords: 10000, outputRecords: 9990, errorRecords: 10,  processingMs: 5000,  status: "completed" },
  { stageId: "st2", name: "Validation",  inputRecords: 9990,  outputRecords: 9800, errorRecords: 190, processingMs: 3000,  status: "completed" },
  { stageId: "st3", name: "Enrichment",  inputRecords: 9800,  outputRecords: 9795, errorRecords: 5,   processingMs: 8000,  status: "completed" },
  { stageId: "st4", name: "Loading",     inputRecords: 9795,  outputRecords: 9793, errorRecords: 2,   processingMs: 2000,  status: "completed" },
];

describe("Venue booking data pipeline", () => {
  it("stageThroughput: ingestion 9990 records in 5s = ~2000/s", () => {
    expect(stageThroughput(STAGES[0])).toBeCloseTo(1998, 0);
  });

  it("stageSuccessRate: validation 190 errors / 9990 = ~98%", () => {
    expect(stageSuccessRate(STAGES[1])).toBe(98);
  });

  it("pipelineDataLoss: 10000 → 9793 = ~2%", () => {
    expect(pipelineDataLoss(STAGES)).toBeCloseTo(2, 0);
  });

  it("bottleneckStage: enrichment (8s slowest)", () => {
    expect(bottleneckStage(STAGES)!.name).toBe("Enrichment");
  });

  it("pipelineStatus: validation < 99% success → degraded", () => {
    expect(pipelineStatus(STAGES)).toBe("degraded"); // 98% < 99%
  });

  it("pipelineStatus: all healthy → healthy", () => {
    const healthy = STAGES.map((s) => ({ ...s, errorRecords: 0 }));
    expect(pipelineStatus(healthy)).toBe("healthy");
  });
});
