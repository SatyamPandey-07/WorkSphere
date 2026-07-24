import { render, screen, act, fireEvent } from "@testing-library/react";
import { MenuTranslatorModal } from "../../components/chat/MenuTranslatorModal";
import "@testing-library/jest-dom";

// Mock Tesseract.js
jest.mock("tesseract.js", () => ({
  createWorker: jest.fn().mockResolvedValue({
    recognize: jest.fn().mockResolvedValue({
      data: {
        text: "Chicken Burger\nVegetable Salad\nGluten-Free Toast\nVegan Taco\n",
      },
    }),
    terminate: jest.fn().mockResolvedValue(null),
  }),
}));

describe("MenuTranslatorModal", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should not render when isOpen is false", () => {
    const { container } = render(
      <MenuTranslatorModal isOpen={false} onClose={jest.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("should render upload and camera capture options when open with no initial photo", () => {
    render(<MenuTranslatorModal isOpen={true} onClose={jest.fn()} />);

    expect(screen.getByText("Upload Menu Photo")).toBeInTheDocument();
    expect(screen.getByText("Use Camera Capture")).toBeInTheDocument();
  });

  it("should render initial photo and translate parameters if initialPhotoUrl is provided", () => {
    render(
      <MenuTranslatorModal
        isOpen={true}
        onClose={jest.fn()}
        initialPhotoUrl="data:image/png;base64,mock"
      />,
    );

    expect(screen.getByAltText("Captured menu preview")).toBeInTheDocument();
    expect(screen.getByText("Translate to")).toBeInTheDocument();
    expect(screen.getByText("Start OCR & Translation")).toBeInTheDocument();
  });

  it("should execute OCR, fetch translation, and render side-by-side results with correct dietary tags", async () => {
    // Mock translate API
    const mockTranslatedText =
      "Chicken Burger (Translated)\nVegetable Salad (Translated)\nGluten-Free Toast (Translated)\nVegan Taco (Translated)";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        translatedText: mockTranslatedText,
      }),
    });

    render(
      <MenuTranslatorModal
        isOpen={true}
        onClose={jest.fn()}
        initialPhotoUrl="data:image/png;base64,mock"
      />,
    );

    const translateBtn = screen.getByText("Start OCR & Translation");
    fireEvent.click(translateBtn);

    // Wait for Tesseract recognize and fetch mock calls
    await act(async () => {
      await Promise.resolve();
    });

    // Check if the original text header exists
    expect(screen.getByText("Original Text (Detected)")).toBeInTheDocument();
    expect(screen.getByText("Translation (English)")).toBeInTheDocument();

    // Verify original line items
    expect(screen.getByText("Chicken Burger")).toBeInTheDocument();
    expect(screen.getByText("Vegetable Salad")).toBeInTheDocument();

    // Verify translated line items
    expect(screen.getByText("Chicken Burger (Translated)")).toBeInTheDocument();
    expect(
      screen.getByText("Vegetable Salad (Translated)"),
    ).toBeInTheDocument();

    // Verify dietary tags are classified and visible
    expect(screen.getByText("Non-Veg")).toBeInTheDocument();
    expect(screen.getByText("Vegetarian")).toBeInTheDocument();
    expect(screen.getByText("Gluten-Free")).toBeInTheDocument();
    expect(screen.getByText("Vegan")).toBeInTheDocument();
  });
});
