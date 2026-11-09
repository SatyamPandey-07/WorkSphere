/**
 * AudioWorkletProcessor implementing an adaptive Normalized Least Mean Squares (NLMS)
 * Acoustic Echo Canceller (AEC) with 512 filter taps to prevent acoustic feedback loops.
 */
class EchoCancellationProcessor extends AudioWorkletProcessor {
  private filterLength = 512;
  private weights: Float32Array;
  private xBuffer: Float32Array; // Speaker reference buffer delay line
  private mu = 0.25; // Normalized step size parameter
  private eps = 1e-6; // Small constant to avoid division by zero

  constructor() {
    super();
    this.weights = new Float32Array(this.filterLength);
    this.xBuffer = new Float32Array(this.filterLength);
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>
  ): boolean {
    const micInput = inputs[0]?.[0]; // Microphone signal (d = echo + desired)
    const speakerRef = inputs[1]?.[0]; // Speaker reference signal (x)
    const cleanOutput = outputs[0]?.[0]; // Echo-cancelled output (e)

    if (!micInput || !cleanOutput) return true;

    const bufferSize = micInput.length;

    for (let i = 0; i < bufferSize; i++) {
      const d = micInput[i];
      const x = speakerRef ? speakerRef[i] : 0;

      // Shift reference sample into delay line buffer
      for (let j = this.filterLength - 1; j > 0; j--) {
        this.xBuffer[j] = this.xBuffer[j - 1];
      }
      this.xBuffer[0] = x;

      // Estimate echo signal (y = w^T * x)
      let y = 0;
      let xEnergy = 0;
      for (let j = 0; j < this.filterLength; j++) {
        const xj = this.xBuffer[j];
        y += this.weights[j] * xj;
        xEnergy += xj * xj;
      }

      // Compute error signal (e = d - y)
      const e = d - y;
      cleanOutput[i] = e;

      // Adapt filter weights dynamically using NLMS equation:
      // w(k+1) = w(k) + (mu / (xEnergy + eps)) * e * x
      const normFactor = this.mu / (xEnergy + this.eps);
      for (let j = 0; j < this.filterLength; j++) {
        this.weights[j] += normFactor * e * this.xBuffer[j];
      }
    }

    return true;
  }
}

registerProcessor("echo-cancellation-processor", EchoCancellationProcessor);