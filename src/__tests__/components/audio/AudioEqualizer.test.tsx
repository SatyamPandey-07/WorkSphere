import { render, screen, fireEvent } from "@testing-library/react";
import { AudioEqualizer } from "@/components/audio/AudioEqualizer";
import { resetEqualizer } from "@/lib/wasm/audioEqualizer";

const wasmBase64 =
  "AGFzbQEAAAABLghgAX8Bf2ACf38AYAAAYAF/AGAGf319fX19AGACf30BfWACfX8BfWAEf39/fwADCQgAAQIDBAUGBwUDAQABBgwCfwFBgAgLfwFBAAsHZQgGbWVtb3J5AgAGbWFsbG9jAAAEZnJlZQABCXJlc2V0SGVhcAACC3NldEJhbmRzUHRyAAMPaW5pdEJpcXVhZFN0YXRlAAQNcHJvY2Vzc1NhbXBsZQAGDHByb2Nlc3NCbG9jawAHCvMDCBEBAX8jACEBIwAgAGokACABCxEAIAAgAWojAEYEQCAAJAALCwcAQYAIJAALBgAgACQBC3EBAX8jASAAQSRsaiEGIAZDAAAAADgCACAGQQRqQwAAAAA4AgAgBkEIakMAAAAAOAIAIAZBDGpDAAAAADgCACAGQRBqIAE4AgAgBkEUaiACOAIAIAZBGGogAzgCACAGQRxqIAQ4AgAgBkEgaiAFOAIAC6EBAQp9IAAqAgAhAiAAQQRqKgIAIQMgAEEIaioCACEEIABBDGoqAgAhBSAAQRBqKgIAIQYgAEEUaioCACEHIABBGGoqAgAhCCAAQRxqKgIAIQkgAEEgaioCACEKIAYgAZQgByAClJIgCCADlJIgCSAElCAKIAWUkpMhCyAAQQxqIAQ4AgAgAEEIaiALOAIAIABBBGogAjgCACAAIAE4AgAgCws6AwF/AX0BfyAAIQNBACECAkADQCACIAFPDQEjASACQSRsaiEEIAQgAxAFIQMgAkEBaiECDAALCyADC24EAX8CfQJ/AX1BACEEAkADQCAEIAJPDQEgACAEQQJ0aioCACEFIAUhCUEAIQcCQANAIAcgA08NASMBIAdBJGxqIQggCCAJEAUhCSAHQQFqIQcMAAsLIAEgBEECdGogCTgCACAEQQFqIQQMAAsLCwCsAgRuYW1lAQ4BBQtwcm9jZXNzQmFuZAL+AQgAAgAEc2l6ZQEDcHRyAQIAA3B0cgEEc2l6ZQIAAwEAA3B0cgQHAAliYW5kSW5kZXgBAmIwAgJiMQMCYjIEAmExBQJhMgYDcHRyBQwAA3B0cgEFaW5wdXQCAngxAwJ4MgQCeTEFAnkyBgJiMAcCYjEIAmIyCQJhMQoCYTILBm91dHB1dAYFAAVpbnB1dAEIbnVtQmFuZHMCAWkDBm91dHB1dAQHYmFuZFB0cgcKAAhpbnB1dFB0cgEJb3V0cHV0UHRyAgZsZW5ndGgDCG51bUJhbmRzBAFpBQVpbnB1dAYGb3V0cHV0BwFqCAdiYW5kUHRyCQpiYW5kT3V0cHV0BxQCAAdoZWFwUHRyAQhiYW5kc1B0cg==";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const wasmBuffer = base64ToArrayBuffer(wasmBase64);

const mockCtx: Record<string, unknown> = {
  clearRect: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
  fill: jest.fn(),
  fillText: jest.fn(),
  closePath: jest.fn(),
  scale: jest.fn(),
  fillRect: jest.fn(),
  strokeStyle: "",
  fillStyle: "",
  lineWidth: 1,
  lineJoin: "",
  font: "",
  textAlign: "",
};

beforeEach(async () => {
  const mockFetch = global.fetch as jest.Mock;
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    arrayBuffer: () => Promise.resolve(wasmBuffer),
  });

  HTMLCanvasElement.prototype.getContext = jest.fn(() => mockCtx);
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });

  await resetEqualizer();
});

it("renders the equalizer with title", async () => {
  render(<AudioEqualizer />);
  expect(screen.getByText("Parametric Equalizer")).toBeInTheDocument();
});

it("renders bypass and reset buttons", async () => {
  render(<AudioEqualizer />);
  expect(screen.getByTitle("Bypass EQ")).toBeInTheDocument();
  expect(screen.getByTitle("Reset to flat")).toBeInTheDocument();
});

it("renders loading state while initializing", () => {
  render(<AudioEqualizer />);
  expect(screen.getByText("Initializing equalizer...")).toBeInTheDocument();
});

it("renders band controls after initialization", async () => {
  render(<AudioEqualizer />);
  const sliders = await screen.findAllByRole("slider", {}, { timeout: 3000 });
  expect(sliders.length).toBeGreaterThanOrEqual(1);
  sliders.forEach((slider) => {
    expect(slider).toHaveAttribute("aria-label");
  });
});

it("updates gain display when slider changes", async () => {
  render(<AudioEqualizer />);
  const sliders = await screen.findAllByRole("slider", {}, { timeout: 3000 });
  const firstSlider = sliders[0];

  fireEvent.change(firstSlider, { target: { value: "6" } });
  const gainLabel = await screen.findByText("+6.0 dB", {}, { timeout: 3000 });
  expect(gainLabel).toBeInTheDocument();
});

it("renders reset button for each band", async () => {
  render(<AudioEqualizer />);

  let errorEl: HTMLElement | null = null;
  try {
    errorEl = screen.queryByText(/Failed to initialize/i);
  } catch {
    // ignore
  }
  if (errorEl) {
    throw new Error(`Component shows error: ${errorEl.textContent}`);
  }

  const sliders = await screen.findAllByRole("slider", {}, { timeout: 3000 });

  const totalButtons = sliders.length + 2;
  const allButtons = await screen.findAllByRole("button", {}, { timeout: 3000 });
  expect(allButtons.length).toBe(totalButtons);
});
