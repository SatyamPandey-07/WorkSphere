import {
  getAudioProfile,
  setAudioProfile,
  isChatSoundEnabled,
  setChatSoundEnabled,
  playCockpitTelemetrySound,
  playSynthesizedBell,
  playStandardBellSound,
  playAudioProfilePreview,
  playChatMessageSound,
  CHAT_SOUND_STORAGE_KEY,
  AUDIO_PROFILE_STORAGE_KEY,
  AUDIO_PROFILE_CHANGE_EVENT,
  CHAT_SOUND_CHANGE_EVENT,
} from "@/lib/chatSound";

describe("chatSound Module", () => {
  const mockSetValueAtTime = jest.fn();
  const mockLinearRampToValueAtTime = jest.fn();
  const mockExponentialRampToValueAtTime = jest.fn();
  const mockConnect = jest.fn();
  const mockStart = jest.fn();
  const mockStop = jest.fn();
  const mockClose = jest.fn().mockResolvedValue(undefined);

  class MockAudioContext {
    currentTime = 0;
    sampleRate = 44100;
    state = "running";
    destination = {};

    createBuffer() {
      return {
        getChannelData: () => new Float32Array(500),
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect: mockConnect,
        start: mockStart,
        stop: mockStop,
      };
    }
    createBiquadFilter() {
      return {
        type: "bandpass",
        frequency: { setValueAtTime: mockSetValueAtTime },
        Q: { setValueAtTime: mockSetValueAtTime },
        connect: mockConnect,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: mockSetValueAtTime,
          linearRampToValueAtTime: mockLinearRampToValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
      };
    }
    createOscillator() {
      return {
        type: "sine",
        frequency: {
          setValueAtTime: mockSetValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
        start: mockStart,
        stop: mockStop,
      };
    }
    close = mockClose;
  }

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (window as any).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Profile and settings management", () => {
    it("returns default profile when unset", () => {
      expect(getAudioProfile()).toBe("Standard Bell");
    });

    it("reads valid profiles correctly", () => {
      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, "Fighter Jet Avionics");
      expect(getAudioProfile()).toBe("Fighter Jet Avionics");

      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, "Mute");
      expect(getAudioProfile()).toBe("Mute");
    });

    it("falls back to Mute when chat_sound_enabled is false and profile unset", () => {
      localStorage.setItem(CHAT_SOUND_STORAGE_KEY, "false");
      expect(getAudioProfile()).toBe("Mute");
    });

    it("sets audio profile, synchronizes enabled state, and dispatches events", () => {
      const profileListener = jest.fn();
      const soundListener = jest.fn();

      window.addEventListener(AUDIO_PROFILE_CHANGE_EVENT, profileListener);
      window.addEventListener(CHAT_SOUND_CHANGE_EVENT, soundListener);

      setAudioProfile("Mute");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Mute");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("false");
      expect(profileListener).toHaveBeenCalled();
      expect(soundListener).toHaveBeenCalled();

      window.removeEventListener(AUDIO_PROFILE_CHANGE_EVENT, profileListener);
      window.removeEventListener(CHAT_SOUND_CHANGE_EVENT, soundListener);
    });

    it("checks and updates isChatSoundEnabled", () => {
      expect(isChatSoundEnabled()).toBe(true);

      setChatSoundEnabled(false);
      expect(isChatSoundEnabled()).toBe(false);
      expect(getAudioProfile()).toBe("Mute");

      setChatSoundEnabled(true);
      expect(isChatSoundEnabled()).toBe(true);
      expect(getAudioProfile()).toBe("Standard Bell");
    });
  });

  describe("playCockpitTelemetrySound", () => {
    it("synthesizes jet static, avionics chirp, and laser lock tones", () => {
      const res = playCockpitTelemetrySound(0.5);
      expect(res).toBe(true);
      expect(mockStart).toHaveBeenCalled();
      expect(mockSetValueAtTime).toHaveBeenCalled();
    });

    it("early exits without throwing when volume is <= 0", () => {
      const resZero = playCockpitTelemetrySound(0);
      expect(resZero).toBe(false);
      expect(mockStart).not.toHaveBeenCalled();

      const resNeg = playCockpitTelemetrySound(-0.5);
      expect(resNeg).toBe(false);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("handles non-finite NaN volume gracefully with fallback", () => {
      const res = playCockpitTelemetrySound(NaN);
      expect(res).toBe(true);
      expect(mockStart).toHaveBeenCalled();
    });

    it("returns false if AudioContext is unavailable", () => {
      delete (window as any).AudioContext;
      delete (window as any).webkitAudioContext;

      const res = playCockpitTelemetrySound(0.5);
      expect(res).toBe(false);
    });
  });

  describe("playSynthesizedBell", () => {
    it("synthesizes subtle bell chime", () => {
      const res = playSynthesizedBell(0.3);
      expect(res).toBe(true);
      expect(mockStart).toHaveBeenCalled();
      expect(mockSetValueAtTime).toHaveBeenCalledWith(0.3, 0);
    });

    it("early exits without throwing when volume is <= 0", () => {
      const res = playSynthesizedBell(0);
      expect(res).toBe(false);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("handles non-finite NaN volume gracefully", () => {
      const res = playSynthesizedBell(NaN);
      expect(res).toBe(true);
      expect(mockStart).toHaveBeenCalled();
    });

    it("returns false if AudioContext is unavailable", () => {
      delete (window as any).AudioContext;
      delete (window as any).webkitAudioContext;

      const res = playSynthesizedBell();
      expect(res).toBe(false);
    });
  });

  describe("playStandardBellSound & preview", () => {
    it("plays audio via HTML5 Audio and falls back on error", () => {
      const mockPlay = jest.fn().mockReturnValue(Promise.reject(new Error("Playback blocked")));
      window.Audio = jest.fn().mockImplementation(() => ({
        play: mockPlay,
      })) as unknown as typeof Audio;

      const res = playStandardBellSound();
      expect(res).toBe(true);
    });

    it("auditions audio profile previews", () => {
      expect(playAudioProfilePreview("Mute")).toBe(false);
      expect(playAudioProfilePreview("Fighter Jet Avionics")).toBe(true);
      expect(playAudioProfilePreview("Standard Bell")).toBe(true);
    });

    it("plays chat message sound according to configured audio profile", () => {
      setAudioProfile("Mute");
      expect(playChatMessageSound()).toBe(false);

      setAudioProfile("Fighter Jet Avionics");
      expect(playChatMessageSound()).toBe(true);

      setAudioProfile("Standard Bell");
      expect(playChatMessageSound()).toBe(true);
    });
  });
});
