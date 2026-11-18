import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatSoundToggle } from "@/components/settings/ChatSoundToggle";
import { ChatPanel } from "@/components/chat/ChatPanel";
import {
  CHAT_SOUND_STORAGE_KEY,
  AUDIO_PROFILE_STORAGE_KEY,
  AUDIO_PROFILE_CHANGE_EVENT,
  isChatSoundEnabled,
  setChatSoundEnabled,
  getAudioProfile,
  setAudioProfile,
  playChatMessageSound,
  playCockpitTelemetrySound,
  playAudioProfilePreview,
} from "@/lib/chatSound";

function createMockAudioContext() {
  const mockOscillator = {
    type: "sine",
    frequency: {
      setValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };

  const mockGain = {
    gain: {
      setValueAtTime: jest.fn(),
      linearRampToValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
  };

  const mockFilter = {
    type: "bandpass",
    frequency: {
      setValueAtTime: jest.fn(),
    },
    Q: {
      setValueAtTime: jest.fn(),
    },
    connect: jest.fn(),
  };

  const mockBufferSource = {
    buffer: null,
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };

  const mockBuffer = {
    getChannelData: jest.fn(() => new Float32Array(500)),
  };

  const ctxInstance = {
    currentTime: 0,
    sampleRate: 44100,
    state: "running",
    destination: {},
    createBuffer: jest.fn(() => mockBuffer),
    createBufferSource: jest.fn(() => mockBufferSource),
    createBiquadFilter: jest.fn(() => mockFilter),
    createGain: jest.fn(() => mockGain),
    createOscillator: jest.fn(() => mockOscillator),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return {
    ctxInstance,
    mockOscillator,
    mockGain,
    mockFilter,
    mockBufferSource,
  };
}

describe("ChatSoundSettings (#3464 & #6169)", () => {
  let playMock: jest.Mock;
  let mockAudioContextHelper: ReturnType<typeof createMockAudioContext>;

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();

    playMock = jest.fn().mockResolvedValue(undefined);
    window.Audio = jest.fn().mockImplementation(() => ({
      play: playMock,
      pause: jest.fn(),
    })) as unknown as typeof Audio;

    mockAudioContextHelper = createMockAudioContext();
    (window as any).AudioContext = jest.fn().mockImplementation(() => mockAudioContextHelper.ctxInstance);
  });

  afterEach(() => {
    delete (window as any).AudioContext;
  });

  describe("LocalStorage & chatSound utility persistence", () => {
    it("defaults to enabled (true) when unset", () => {
      expect(isChatSoundEnabled()).toBe(true);
    });

    it("respects explicitly stored false value", () => {
      localStorage.setItem(CHAT_SOUND_STORAGE_KEY, "false");
      expect(isChatSoundEnabled()).toBe(false);
    });

    it("respects explicitly stored true value", () => {
      localStorage.setItem(CHAT_SOUND_STORAGE_KEY, "true");
      expect(isChatSoundEnabled()).toBe(true);
    });

    it("persists updates through setChatSoundEnabled", () => {
      setChatSoundEnabled(false);
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("false");
      expect(isChatSoundEnabled()).toBe(false);

      setChatSoundEnabled(true);
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("true");
      expect(isChatSoundEnabled()).toBe(true);
    });

    it("plays audio when enabled and silences audio when disabled", () => {
      setChatSoundEnabled(true);
      const playedWhenEnabled = playChatMessageSound();
      expect(playedWhenEnabled).toBe(true);
      expect(playMock).toHaveBeenCalledTimes(1);

      setChatSoundEnabled(false);
      const playedWhenDisabled = playChatMessageSound();
      expect(playedWhenDisabled).toBe(false);
      expect(playMock).toHaveBeenCalledTimes(1); // Not called again
    });
  });

  describe("Audio Profile & Cockpit Sound Effects (#6169)", () => {
    it("defaults to 'Standard Bell' when worksphere_audio_profile is unset", () => {
      expect(getAudioProfile()).toBe("Standard Bell");
    });

    it("reads persisted 'Fighter Jet Avionics' profile from localStorage", () => {
      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, "Fighter Jet Avionics");
      expect(getAudioProfile()).toBe("Fighter Jet Avionics");
      expect(isChatSoundEnabled()).toBe(true);
    });

    it("reads persisted 'Mute' profile from localStorage and treats sound as disabled", () => {
      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, "Mute");
      expect(getAudioProfile()).toBe("Mute");
      expect(isChatSoundEnabled()).toBe(false);
    });

    it("returns 'Mute' when backward compatible worksphere_chat_sound_enabled is false", () => {
      localStorage.setItem(CHAT_SOUND_STORAGE_KEY, "false");
      expect(getAudioProfile()).toBe("Mute");
    });

    it("persists selection through setAudioProfile and synchronizes sound enabled state", () => {
      setAudioProfile("Fighter Jet Avionics");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Fighter Jet Avionics");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("true");
      expect(isChatSoundEnabled()).toBe(true);

      setAudioProfile("Mute");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Mute");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("false");
      expect(isChatSoundEnabled()).toBe(false);

      setAudioProfile("Standard Bell");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Standard Bell");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("true");
      expect(isChatSoundEnabled()).toBe(true);
    });

    it("dispatches AUDIO_PROFILE_CHANGE_EVENT on setAudioProfile", () => {
      const listener = jest.fn();
      window.addEventListener(AUDIO_PROFILE_CHANGE_EVENT, listener);

      setAudioProfile("Fighter Jet Avionics");
      expect(listener).toHaveBeenCalledTimes(1);

      window.removeEventListener(AUDIO_PROFILE_CHANGE_EVENT, listener);
    });

    it("synthesizes Hal Jordan cockpit telemetry sound (jet radio static, avionics chirp, laser lock)", () => {
      const played = playCockpitTelemetrySound();
      expect(played).toBe(true);
      expect((window as any).AudioContext).toHaveBeenCalled();
      // Verifies noise buffer, bandpass filter, and oscillators were created
      expect(mockAudioContextHelper.ctxInstance.createBufferSource).toHaveBeenCalled();
      expect(mockAudioContextHelper.ctxInstance.createBiquadFilter).toHaveBeenCalled();
      expect(mockAudioContextHelper.ctxInstance.createOscillator).toHaveBeenCalled();
    });

    it("handles absent AudioContext gracefully in playCockpitTelemetrySound", () => {
      delete (window as any).AudioContext;
      const played = playCockpitTelemetrySound();
      expect(played).toBe(false);
    });

    it("plays cockpit telemetry sound when incoming chat sound is triggered with Fighter Jet Avionics", () => {
      setAudioProfile("Fighter Jet Avionics");
      const played = playChatMessageSound();
      expect(played).toBe(true);
      expect(mockAudioContextHelper.ctxInstance.createOscillator).toHaveBeenCalled();
    });

    it("previews audio profile without checking global mute state", () => {
      const playedBell = playAudioProfilePreview("Standard Bell");
      expect(playedBell).toBe(true);
      expect(playMock).toHaveBeenCalledTimes(1);

      const playedAvionics = playAudioProfilePreview("Fighter Jet Avionics");
      expect(playedAvionics).toBe(true);
      expect(mockAudioContextHelper.ctxInstance.createOscillator).toHaveBeenCalled();

      const playedMute = playAudioProfilePreview("Mute");
      expect(playedMute).toBe(false);
    });
  });

  describe("ChatSoundToggle Component with Audio Profile Dropdown (#6169)", () => {
    it("renders toggle switch and defaults to checked", () => {
      render(<ChatSoundToggle />);
      const toggle = screen.getByRole("switch", { name: "Chat Sound Effects" });
      expect(toggle).toBeInTheDocument();
      expect(toggle).toBeChecked();
    });

    it("initializes to unchecked if localStorage has false", () => {
      localStorage.setItem(CHAT_SOUND_STORAGE_KEY, "false");
      render(<ChatSoundToggle />);
      const toggle = screen.getByRole("switch", { name: "Chat Sound Effects" });
      expect(toggle).not.toBeChecked();
    });

    it("renders sound profile dropdown with all 3 options and preview button", () => {
      render(<ChatSoundToggle />);
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;
      expect(dropdown).toBeInTheDocument();
      expect(dropdown.value).toBe("Standard Bell");

      const options = Array.from(dropdown.options).map((opt) => opt.value);
      expect(options).toEqual(["Standard Bell", "Fighter Jet Avionics", "Mute"]);

      const previewBtn = screen.getByTestId("preview-sound-button");
      expect(previewBtn).toBeInTheDocument();
      expect(previewBtn).not.toBeDisabled();
    });

    it("switches profile to 'Fighter Jet Avionics', updates localStorage, and renders telemetry badge", () => {
      render(<ChatSoundToggle />);
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;

      fireEvent.change(dropdown, { target: { value: "Fighter Jet Avionics" } });

      expect(dropdown.value).toBe("Fighter Jet Avionics");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Fighter Jet Avionics");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("true");

      const toggle = screen.getByRole("switch", { name: "Chat Sound Effects" });
      expect(toggle).toBeChecked();

      expect(screen.getByTestId("cockpit-telemetry-badge")).toBeInTheDocument();
      expect(screen.getByText(/Fighter Jet Cockpit Telemetry/i)).toBeInTheDocument();
    });

    it("switches profile to 'Mute' from dropdown, unchecking toggle switch and disabling preview", () => {
      render(<ChatSoundToggle />);
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;
      const toggle = screen.getByRole("switch", { name: "Chat Sound Effects" });
      const previewBtn = screen.getByTestId("preview-sound-button");

      fireEvent.change(dropdown, { target: { value: "Mute" } });

      expect(dropdown.value).toBe("Mute");
      expect(toggle).not.toBeChecked();
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Mute");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("false");
      expect(previewBtn).toBeDisabled();
    });

    it("toggles switch off, setting dropdown to 'Mute' and worksphere_audio_profile to 'Mute'", () => {
      render(<ChatSoundToggle />);
      const toggle = screen.getByRole("switch", { name: "Chat Sound Effects" });
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;

      // Click to disable
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();
      expect(dropdown.value).toBe("Mute");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Mute");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("false");

      // Click to re-enable restores Standard Bell
      fireEvent.click(toggle);
      expect(toggle).toBeChecked();
      expect(dropdown.value).toBe("Standard Bell");
      expect(localStorage.getItem(AUDIO_PROFILE_STORAGE_KEY)).toBe("Standard Bell");
      expect(localStorage.getItem(CHAT_SOUND_STORAGE_KEY)).toBe("true");
    });

    it("triggers preview sound when preview button is clicked", () => {
      render(<ChatSoundToggle />);
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;
      const previewBtn = screen.getByTestId("preview-sound-button");

      // Preview Standard Bell
      fireEvent.click(previewBtn);
      expect(playMock).toHaveBeenCalledTimes(1);

      // Switch to Fighter Jet Avionics and preview
      fireEvent.change(dropdown, { target: { value: "Fighter Jet Avionics" } });
      fireEvent.click(previewBtn);
      expect(mockAudioContextHelper.ctxInstance.createOscillator).toHaveBeenCalled();
    });

    it("invokes onSoundChange callback when audio state changes", () => {
      const onSoundChange = jest.fn();
      render(<ChatSoundToggle onSoundChange={onSoundChange} />);
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;

      fireEvent.change(dropdown, { target: { value: "Mute" } });
      expect(onSoundChange).toHaveBeenCalledWith(false);

      fireEvent.change(dropdown, { target: { value: "Fighter Jet Avionics" } });
      expect(onSoundChange).toHaveBeenCalledWith(true);
    });

    it("handles storage event from other tabs synchronizing worksphere_audio_profile", () => {
      render(<ChatSoundToggle />);
      const dropdown = screen.getByTestId("audio-profile-select") as HTMLSelectElement;

      localStorage.setItem(AUDIO_PROFILE_STORAGE_KEY, "Fighter Jet Avionics");
      localStorage.setItem(CHAT_SOUND_STORAGE_KEY, "true");

      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: AUDIO_PROFILE_STORAGE_KEY,
            newValue: "Fighter Jet Avionics",
          })
        );
      });

      expect(dropdown.value).toBe("Fighter Jet Avionics");
      expect(screen.getByTestId("cockpit-telemetry-badge")).toBeInTheDocument();
    });
  });

  describe("ChatPanel Audio Hook Integration", () => {
    it("plays incoming audio chime when sound is enabled", () => {
      setChatSoundEnabled(true);

      const initialMessages = [{ id: "1", role: "user", content: "Hello" }];
      const { rerender } = render(<ChatPanel messages={initialMessages} />);

      expect(playMock).not.toHaveBeenCalled();

      // Incoming assistant message
      const updatedMessages = [
        ...initialMessages,
        { id: "2", role: "assistant", content: "Hi! How can I help you today?" },
      ];
      rerender(<ChatPanel messages={updatedMessages} />);

      expect(playMock).toHaveBeenCalledTimes(1);
    });

    it("silences incoming audio chime when sound is disabled", () => {
      setChatSoundEnabled(false);

      const initialMessages = [{ id: "1", role: "user", content: "Hello" }];
      const { rerender } = render(<ChatPanel messages={initialMessages} />);

      // Incoming assistant message while muted
      const updatedMessages = [
        ...initialMessages,
        { id: "2", role: "assistant", content: "Hi! How can I help you today?" },
      ];
      rerender(<ChatPanel messages={updatedMessages} />);

      expect(playMock).not.toHaveBeenCalled();
    });

    it("does not play audio chime for outgoing user messages", () => {
      setChatSoundEnabled(true);

      const initialMessages = [{ id: "1", role: "user", content: "Hello" }];
      const { rerender } = render(<ChatPanel messages={initialMessages} />);

      // User sends another message
      const updatedMessages = [
        ...initialMessages,
        { id: "2", role: "user", content: "Another question" },
      ];
      rerender(<ChatPanel messages={updatedMessages} />);

      expect(playMock).not.toHaveBeenCalled();
    });
  });
});
