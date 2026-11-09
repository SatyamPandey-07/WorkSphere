export class ErgonomicChimeSynthesizer {
  private audioContext: AudioContext | null = null;

  private getAudioContext(): AudioContext {
    if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
      throw new Error("Web Audio is not available in this browser.");
    }

    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new window.AudioContext();
    }

    return this.audioContext;
  }

  public async prepare(): Promise<void> {
    const context = this.getAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
  }

  public async playGentleChime(volume = 0.5): Promise<void> {
    await this.prepare();
    const context = this.getAudioContext();
    const normalizedVolume = Math.min(1, Math.max(0, volume));
    if (normalizedVolume === 0) return;

    const notes = [
      { frequency: 659.25, startOffset: 0 },
      { frequency: 880, startOffset: 0.18 },
    ];

    for (const note of notes) {
      const startTime = context.currentTime + note.startOffset;
      const endTime = startTime + 0.9;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, startTime);
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(normalizedVolume * 0.12, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(startTime);
      oscillator.stop(endTime);
    }
  }

  public async dispose(): Promise<void> {
    const context = this.audioContext;
    this.audioContext = null;

    if (context && context.state !== "closed") {
      await context.close();
    }
  }
}
