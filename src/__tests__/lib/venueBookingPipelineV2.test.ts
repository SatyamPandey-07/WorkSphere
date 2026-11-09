describe("Booking pipeline", () => {
  function pipelineStage(name: string, input: number): number { return input * 2; }
  function runPipeline(stages: ((n: number) => number)[], input: number): number {
    return stages.reduce((v, fn) => fn(v), input);
  }
  it("pipelineStage doubles input", () => { expect(pipelineStage("x", 5)).toBe(10); });
  it("runPipeline chains stages", () => { expect(runPipeline([(n) => n + 1, (n) => n * 2], 3)).toBe(8); });
  it("empty pipeline returns input", () => { expect(runPipeline([], 42)).toBe(42); });
});
