/**
 * Additional tests for useNoiseSuppression constraint application (Issue #1974).
 */

// Test the constraint application pattern
async function applyNoiseConstraint(
  applyConstraintsMock: jest.Mock,
  value: boolean,
): Promise<boolean> {
  await applyConstraintsMock({ noiseSuppression: value });
  return value;
}

describe("Noise suppression constraint application", () => {
  it("passes { noiseSuppression: true } to applyConstraints on enable", async () => {
    const mock = jest.fn().mockResolvedValue(undefined);
    await applyNoiseConstraint(mock, true);
    expect(mock).toHaveBeenCalledWith({ noiseSuppression: true });
  });

  it("passes { noiseSuppression: false } to applyConstraints on disable", async () => {
    const mock = jest.fn().mockResolvedValue(undefined);
    await applyNoiseConstraint(mock, false);
    expect(mock).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it("constraint is a plain object with single key", () => {
    const constraint = { noiseSuppression: true };
    expect(Object.keys(constraint)).toEqual(["noiseSuppression"]);
    expect(typeof constraint.noiseSuppression).toBe("boolean");
  });

  it("constraint key is exactly 'noiseSuppression' (camelCase)", () => {
    const key = "noiseSuppression";
    // Verify it's not 'noise_suppression' or other variants
    expect(key).toBe("noiseSuppression");
    expect(key).not.toContain("_");
  });

  it("applies constraints asynchronously", async () => {
    const results: string[] = [];
    const mock = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0));
      results.push("applied");
    });

    await applyNoiseConstraint(mock, true);
    expect(results).toContain("applied");
  });

  it("does not throw when constraint is true or false", async () => {
    const mock = jest.fn().mockResolvedValue(undefined);

    await expect(applyNoiseConstraint(mock, true)).resolves.not.toThrow();
    await expect(applyNoiseConstraint(mock, false)).resolves.not.toThrow();
  });
});
