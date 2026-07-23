import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MessageRenderer } from "@/components/chat/GenerativeUI";
import { ReadAloudButton } from "@/components/chat/ReadAloudButton";

describe("MessageRenderer sentence highlighting", () => {
  it("renders plain text without highlights when speakingSentenceIndex is null", () => {
    render(
      <MessageRenderer
        content="First sentence. Second sentence."
        speakingSentenceIndex={null}
      />,
    );
    expect(
      screen.getByText("First sentence. Second sentence."),
    ).toBeInTheDocument();
  });

  it("highlights sentence matching speakingSentenceIndex", () => {
    const { container } = render(
      <MessageRenderer
        content="First sentence. Second sentence."
        speakingSentenceIndex={1}
      />,
    );

    const mark = container.querySelector("mark");
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toBe("Second sentence.");
  });
});

describe("ReadAloudButton UI component", () => {
  let mockSpeak: jest.Mock;
  let mockCancel: jest.Mock;
  let createdUtterances: any[] = [];

  class MockSpeechSynthesisUtterance {
    text: string;
    rate: number = 1;
    pitch: number = 1;
    lang: string = "";
    voice: any = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: any) => void) | null = null;

    constructor(text?: string) {
      this.text = text || "";
      createdUtterances.push(this);
    }
  }

  beforeEach(() => {
    createdUtterances = [];
    mockSpeak = jest.fn();
    mockCancel = jest.fn();

    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: MockSpeechSynthesisUtterance,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: mockSpeak,
        cancel: mockCancel,
        pause: jest.fn(),
        resume: jest.fn(),
        getVoices: jest.fn().mockReturnValue([]),
        onvoiceschanged: null,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders Read Aloud button and adjacent speed selection dropdown", () => {
    render(<ReadAloudButton text="Sample text to read" />);

    expect(
      screen.getByRole("button", { name: /Read message aloud/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Playback speed/i }),
    ).toBeInTheDocument();
  });

  it("includes 1x, 1.25x, and 1.5x speed options in the dropdown", () => {
    render(<ReadAloudButton text="Sample text to read" />);

    const select = screen.getByRole("combobox", {
      name: /Playback speed/i,
    }) as HTMLSelectElement;
    const options = Array.from(select.options).map((opt) => opt.textContent);

    expect(options).toContain("1x");
    expect(options).toContain("1.25x");
    expect(options).toContain("1.5x");
    expect(options).toContain("0.75x");
    expect(options).toContain("1.75x");
    expect(options).toContain("2x");
  });

  it("starts speaking when Read Aloud button is clicked", () => {
    render(<ReadAloudButton text="Sample text to read" />);

    const button = screen.getByRole("button", { name: /Read message aloud/i });
    fireEvent.click(button);

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(createdUtterances.length).toBe(1);
    expect(createdUtterances[0].text).toBe("Sample text to read");
    expect(createdUtterances[0].rate).toBe(1);
  });

  it("updates rate parameter when speed dropdown selection is changed to 1.25x or 1.5x", () => {
    render(<ReadAloudButton text="Sample text to read" />);

    const select = screen.getByRole("combobox", { name: /Playback speed/i });

    // Change to 1.25x
    fireEvent.change(select, { target: { value: "1.25" } });

    const button = screen.getByRole("button", { name: /Read message aloud/i });
    fireEvent.click(button);

    expect(createdUtterances[createdUtterances.length - 1].rate).toBe(1.25);

    // Change to 1.5x
    fireEvent.change(select, { target: { value: "1.5" } });
    fireEvent.click(button);

    expect(createdUtterances[createdUtterances.length - 1].rate).toBe(1.5);
  });

  it("toggles to Stop button while speaking and cancels playback on click", () => {
    render(<ReadAloudButton text="Sample text to read" />);

    const button = screen.getByRole("button", { name: /Read message aloud/i });
    fireEvent.click(button);

    const utterance = createdUtterances[0];
    act(() => {
      utterance.onstart?.();
    });

    const stopButton = screen.getByRole("button", {
      name: /Stop reading aloud/i,
    });
    expect(stopButton).toBeInTheDocument();
    expect(stopButton).toHaveTextContent("Stop");

    fireEvent.click(stopButton);
    expect(mockCancel).toHaveBeenCalled();
  });
});
