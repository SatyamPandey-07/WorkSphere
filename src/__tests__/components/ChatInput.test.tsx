import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { ChatInput } from "../../components/chat/ChatMessages";
import "@testing-library/jest-dom";

// Mock framer-motion to avoid animation timing issues in tests
jest.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

describe("ChatInput Recent Searches", () => {
  const mockOnInputChange = jest.fn();
  const mockOnSubmit = jest.fn((e) => e.preventDefault());

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it("does not display recent searches panel when focused if history is empty", () => {
    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    expect(screen.queryByText("Recent Searches")).not.toBeInTheDocument();
  });

  it("displays recent searches panel when focused if history has entries", () => {
    localStorage.setItem(
      "ws-recent-searches",
      JSON.stringify(["quiet cafe", "coworking space"]),
    );

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    expect(screen.getByText("Recent Searches")).toBeInTheDocument();
    expect(screen.getByText("quiet cafe")).toBeInTheDocument();
    expect(screen.getByText("coworking space")).toBeInTheDocument();
  });

  it("adds query to localStorage on submit", () => {
    render(
      <ChatInput
        input="starbucks wifi"
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const form = screen
      .getByPlaceholderText("Where's the focus mode hotspot?")
      .closest("form");
    expect(form).toBeInTheDocument();
    fireEvent.submit(form!);

    expect(mockOnSubmit).toHaveBeenCalledTimes(1);

    const stored = JSON.parse(
      localStorage.getItem("ws-recent-searches") || "[]",
    );
    expect(stored).toContain("starbucks wifi");
  });

  it("calls onInputChange with search term on chip mouse down", () => {
    localStorage.setItem(
      "ws-recent-searches",
      JSON.stringify(["library outlets"]),
    );

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    const chip = screen.getByText("library outlets");
    fireEvent.mouseDown(chip);

    expect(mockOnInputChange).toHaveBeenCalledWith("library outlets");
  });

  it("clears history when clear is clicked", () => {
    localStorage.setItem("ws-recent-searches", JSON.stringify(["old search"]));

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={mockOnInputChange}
        onSubmit={mockOnSubmit}
      />,
    );

    const inputEl = screen.getByPlaceholderText(
      "Where's the focus mode hotspot?",
    );
    fireEvent.focus(inputEl);

    const clearBtn = screen.getByText("Clear");
    fireEvent.mouseDown(clearBtn);

    expect(localStorage.getItem("ws-recent-searches")).toBeNull();
    expect(screen.queryByText("Recent Searches")).not.toBeInTheDocument();
  });
});

describe("ChatInput keyboard inset", () => {
  const listeners: Record<string, Array<() => void>> = {};

  beforeEach(() => {
    Object.keys(listeners).forEach((k) => delete listeners[k]);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 100,
        offsetTop: 0,
        addEventListener: (type: string, cb: () => void) => {
          listeners[type] = listeners[type] || [];
          listeners[type].push(cb);
        },
        removeEventListener: (type: string, cb: () => void) => {
          listeners[type] = (listeners[type] || []).filter((fn) => fn !== cb);
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
  });

  it("pads the composer when the visual viewport shrinks", () => {
    const { container } = render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    act(() => {
      listeners["resize"]?.forEach((cb) => cb());
    });

    const wrap = container.firstChild as HTMLElement;
    expect(wrap.getAttribute("data-keyboard-inset")).toBe("700");
  });
});

describe("ChatInput Ctrl+K shortcut badge", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows Ctrl+K badge in the empty search bar on non-Apple platforms", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "Win32",
    });

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByTitle("Focus search")).toHaveTextContent("Ctrl+K");
  });

  it("shows ⌘K badge on Apple platforms", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByTitle("Focus search")).toHaveTextContent("⌘K");
  });

  it("hides the shortcut badge when the search input has text", () => {
    render(
      <ChatInput
        input="quiet cafe"
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.queryByTitle("Focus search")).not.toBeInTheDocument();
  });
});

describe("ChatInput image attachment and preview modal workflow", () => {
  const originalCreateObjectURL = global.URL.createObjectURL;
  const originalRevokeObjectURL = global.URL.revokeObjectURL;

  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(
      () => "blob:http://localhost/mock-preview",
    );
    global.URL.revokeObjectURL = jest.fn();
  });

  afterAll(() => {
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("triggers file picker when attach image button is clicked", () => {
    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    const fileInput = screen.getByTestId("chat-image-file-input");
    const clickSpy = jest.spyOn(fileInput, "click");

    const attachBtn = screen.getByTestId("chat-attach-image-btn");
    fireEvent.click(attachBtn);

    expect(clickSpy).toHaveBeenCalled();
  });

  it("opens preview modal when an image file is selected and closes on cancel", () => {
    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    const fileInput = screen.getByTestId("chat-image-file-input");
    const testFile = new File(["dummy-data"], "workspace.png", {
      type: "image/png",
    });

    fireEvent.change(fileInput, { target: { files: [testFile] } });

    // Modal should be opened
    expect(
      screen.getByTestId("image-upload-preview-modal"),
    ).toBeInTheDocument();
    expect(screen.getByText("workspace.png")).toBeInTheDocument();

    // Cancel modal
    const cancelBtn = screen.getByTestId("cancel-preview-btn");
    fireEvent.click(cancelBtn);

    // Modal should close
    expect(
      screen.queryByTestId("image-upload-preview-modal"),
    ).not.toBeInTheDocument();
  });

  it("calls onImageUpload when modal upload is confirmed", async () => {
    const mockOnImageUpload = jest.fn();

    render(
      <ChatInput
        input=""
        isLoading={false}
        onInputChange={jest.fn()}
        onSubmit={jest.fn()}
        onImageUpload={mockOnImageUpload}
      />,
    );

    const fileInput = screen.getByTestId("chat-image-file-input");
    const testFile = new File(["dummy-data"], "workspace.png", {
      type: "image/png",
    });

    fireEvent.change(fileInput, { target: { files: [testFile] } });

    expect(
      screen.getByTestId("image-upload-preview-modal"),
    ).toBeInTheDocument();

    const uploadBtn = screen.getByTestId("confirm-upload-btn");
    await act(async () => {
      fireEvent.click(uploadBtn);
    });

    await waitFor(() => {
      expect(mockOnImageUpload).toHaveBeenCalledTimes(1);
      expect(mockOnImageUpload.mock.calls[0][0].file.name).toBe(
        "workspace.png",
      );
      expect(
        screen.queryByTestId("image-upload-preview-modal"),
      ).not.toBeInTheDocument();
    });
  });
});
