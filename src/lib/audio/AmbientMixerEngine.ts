export class AmbientMixerEngine {
  private audioCtx: AudioContext | null = null;
  private aecNode: AudioWorkletNode | null = null;

  public async initializeAEC(micStream: MediaStream, speakerNode: AudioNode) {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ latencyHint: "interactive" });
    }

    await this.audioCtx.audioWorklet.addModule("/worklets/EchoCancellationWorklet.js");

    const micSource = this.audioCtx.createMediaStreamSource(micStream);
    
    // Create AudioWorkletNode with 2 inputs: [0] = mic, [1] = speaker reference
    this.aecNode = new AudioWorkletNode(this.audioCtx, "echo-cancellation-processor", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });

    micSource.connect(this.aecNode, 0, 0);
    speakerNode.connect(this.aecNode, 0, 1);

    return this.aecNode;
  }

  public stop() {
    if (this.aecNode) {
      this.aecNode.disconnect();
      this.aecNode = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}