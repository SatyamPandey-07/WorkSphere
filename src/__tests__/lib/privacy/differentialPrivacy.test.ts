import { generateLaplaceNoise, applyPrivacyFilter } from "@/lib/privacy/differentialPrivacy";

describe("Differential Privacy Engine", () => {
  describe("generateLaplaceNoise", () => {
    it("should throw if epsilon <= 0", () => {
      expect(() => generateLaplaceNoise(0)).toThrow("Epsilon must be > 0");
      expect(() => generateLaplaceNoise(-0.5)).toThrow();
    });

    it("should approximate Laplace distribution with mean ~ 0 and variance ~ 2b^2", () => {
      const numSamples = 100000;
      const epsilon = 1.0;
      const deltaF = 1;
      const b = deltaF / epsilon;
      
      let sum = 0;
      let sumSq = 0;
      
      for (let i = 0; i < numSamples; i++) {
        const x = generateLaplaceNoise(epsilon, deltaF);
        sum += x;
        sumSq += x * x;
      }
      
      const mean = sum / numSamples;
      const variance = (sumSq / numSamples) - (mean * mean);
      const expectedVariance = 2 * Math.pow(b, 2);
      
      // Mean should be close to 0
      expect(Math.abs(mean)).toBeLessThan(0.05); // Reasonable tolerance for 100k samples
      
      // Variance should be close to 2b^2
      // Using a tolerance around 5% of expected variance
      expect(Math.abs(variance - expectedVariance)).toBeLessThan(expectedVariance * 0.05);
    });
  });

  describe("applyPrivacyFilter", () => {
    it("should bypass filter if trueCount >= threshold", () => {
      // Threshold is 10 by default
      const result = applyPrivacyFilter(12, 50, 1.0, 10);
      expect(result).toBe(12);
    });

    it("should apply noise if trueCount < threshold", () => {
      // Since it's random, we can't always guarantee result != trueCount in a single run 
      // (it might round back to trueCount), but over many runs variance should be high.
      let different = false;
      for (let i = 0; i < 100; i++) {
        const result = applyPrivacyFilter(5, 50, 0.5, 10);
        if (result !== 5) {
          different = true;
          break;
        }
      }
      expect(different).toBe(true);
    });

    it("should clamp noisy output to valid integer ranges [0, maxCapacity]", () => {
      let minFound = Infinity;
      let maxFound = -Infinity;
      
      // Force extreme noise with a tiny epsilon
      for (let i = 0; i < 1000; i++) {
        const result = applyPrivacyFilter(2, 5, 0.01, 10);
        minFound = Math.min(minFound, result);
        maxFound = Math.max(maxFound, result);
      }
      
      expect(minFound).toBeGreaterThanOrEqual(0);
      expect(maxFound).toBeLessThanOrEqual(5);
      
      // We expect it to hit the boundaries because noise is very high
      expect(minFound).toBe(0);
      expect(maxFound).toBe(5);
    });
    
    it("should return integers", () => {
      for (let i = 0; i < 100; i++) {
        const result = applyPrivacyFilter(3, 20, 1.0, 10);
        expect(Number.isInteger(result)).toBe(true);
      }
    });
  });
});
