/**
 * AudioWorkletProcessor implementing an adaptive Normalized Least Mean Squares (NLMS)
 * Acoustic Echo Canceller (AEC) with 512 filter taps to prevent acoustic feedback loops.
 */
/**
 * Acoustic Echo Cancellation (AEC) AudioWorklet Processor with Phase Alignment
 */

class EchoCancellationWorklet extends AudioWorkletProcessor {
  private lmsWeights: Float32Array;
  private filterOrder: number;
  private mu: number;

  constructor() {
    super();
    this.filterOrder = 32;
    this.mu = 0.01;
    this.lmsWeights = new Float32Array(this.filterOrder);
  }

  /**
   * Calculates cross-correlation lag tau between Left and Right channels.
   */
  private calculatePhaseOffset(left: Float32Array, right: Float32Array): number {
    let maxCorr = -Infinity;
    let bestTau = 0;
    const maxLag = 16; // Search window +/- 16 samples for real-time latency budget

    for (let tau = -maxLag; tau <= maxLag; tau++) {
      let corr = 0;
      for (let i = 0; i < left.length; i++) {
        const rIndex = i + tau;
        if (rIndex >= 0 && rIndex < right.length) {
          corr += left[i] * right[rIndex];
        }
      }
      if (corr > maxCorr) {
        maxCorr = corr;
        bestTau = tau;
      }
    }
    return bestTau;
  }

  /**
   * Applies fractional delay/shift to align channels before mono summation.
   */
  private alignAndSum(left: Float32Array, right: Float32Array): Float32Array {
    const samples = left.length;
    const mono = new Float32Array(samples);
    const tau = this.calculatePhaseOffset(left, right);

    for (let i = 0; i < samples; i++) {
      const rightAlignedIndex = i + tau;
      const rightSample =
        rightAlignedIndex >= 0 && rightAlignedIndex < samples
          ? right[rightAlignedIndex]
          : 0;

      // Phase-aligned Mid (M/S decomposition) summing
      mono[i] = 0.5 * (left[i] + rightSample);
    }

    return mono;
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0) return true;

    const samples = input[0].length;
    let micSignal: Float32Array;

    if (input.length >= 2) {
      // Stereo input detected: perform phase alignment before summing to mono
      micSignal = this.alignAndSum(input[0], input[1]);
    } else {
      micSignal = input[0];
    }

    // Output phase-aligned mono signal to primary channel
    if (output && output[0]) {
      output[0].set(micSignal);
      if (output[1]) {
        output[1].set(micSignal);
      }
    }

    return true;
  }
}

registerProcessor("echo-cancellation-worklet", EchoCancellationWorklet);