import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultDeskMatcherQuizModal, {
  DeskMatcherQuizModal,
  type DeskMatcherQuizModalProps,
} from "@/components/quiz/DeskMatcherQuizModal";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe("DeskMatcherQuizModal Component", () => {
  const defaultProps: DeskMatcherQuizModalProps = {
    isOpen: true,
    onClose: jest.fn(),
    onMatched: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ success: true }),
    } as any);
  });

  it("exports named and default components identically", () => {
    expect(DeskMatcherQuizModal).toBeDefined();
    expect(DefaultDeskMatcherQuizModal).toBe(DeskMatcherQuizModal);
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(<DeskMatcherQuizModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders modal dialog, header, progress indicator, and initial step when open", () => {
    render(<DeskMatcherQuizModal {...defaultProps} />);

    expect(screen.getByTestId("desk-matcher-modal")).toBeInTheDocument();
    expect(screen.getByText("Smart Desk Matcher Quiz")).toBeInTheDocument();
    expect(screen.getAllByText("Step 1 of 5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("desk-matcher-back-btn")).toBeDisabled();
    expect(screen.getByTestId("desk-matcher-next-btn")).toBeInTheDocument();
  });

  it("navigates forward and backward through quiz steps", () => {
    render(<DeskMatcherQuizModal {...defaultProps} />);

    const nextBtn = screen.getByTestId("desk-matcher-next-btn");
    const backBtn = screen.getByTestId("desk-matcher-back-btn");

    // Advance to Step 2
    fireEvent.click(nextBtn);
    expect(screen.getAllByText("Step 2 of 5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/What is your ambient noise preference/i)).toBeInTheDocument();
    expect(backBtn).not.toBeDisabled();

    // Advance to Step 3
    fireEvent.click(nextBtn);
    expect(screen.getAllByText("Step 3 of 5").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/What hardware & desk setup do you need/i)).toBeInTheDocument();

    // Go back to Step 2
    fireEvent.click(backBtn);
    expect(screen.getAllByText("Step 2 of 5").length).toBeGreaterThanOrEqual(1);
  });

  it("allows selecting quiz options at each step", () => {
    render(<DeskMatcherQuizModal {...defaultProps} />);

    // Step 1: select creative option
    const creativeOpt = screen.getByTestId("quiz-option-creative");
    fireEvent.click(creativeOpt);
    expect(creativeOpt).toHaveClass("border-violet-500");

    // Advance to Step 2: select silent option
    fireEvent.click(screen.getByTestId("desk-matcher-next-btn"));
    const silentOpt = screen.getByTestId("quiz-option-silent");
    fireEvent.click(silentOpt);
    expect(silentOpt).toHaveClass("border-violet-500");
  });

  it("completes all 5 steps and displays archetype match result", async () => {
    render(<DeskMatcherQuizModal {...defaultProps} initialStep={5} />);

    expect(screen.getAllByText("Step 5 of 5").length).toBeGreaterThanOrEqual(1);
    const generateBtn = screen.getByTestId("desk-matcher-next-btn");
    expect(generateBtn).toHaveTextContent("Generate Match");

    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByTestId("desk-matcher-result-card")).toBeInTheDocument();
    });

    expect(defaultProps.onMatched).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("/api/user/settings", expect.any(Object));

    expect(screen.getByTestId("desk-matcher-retake-btn")).toBeInTheDocument();
    expect(screen.getByTestId("desk-matcher-explore-btn")).toBeInTheDocument();
  });

  it("handles retake quiz from results screen", async () => {
    render(<DeskMatcherQuizModal {...defaultProps} initialStep={5} />);

    fireEvent.click(screen.getByTestId("desk-matcher-next-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("desk-matcher-retake-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("desk-matcher-retake-btn"));
    expect(screen.getAllByText("Step 1 of 5").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId("desk-matcher-result-card")).not.toBeInTheDocument();
  });

  it("explores matched desks by pushing query parameters to router", async () => {
    render(<DeskMatcherQuizModal {...defaultProps} initialStep={5} />);

    fireEvent.click(screen.getByTestId("desk-matcher-next-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("desk-matcher-explore-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("desk-matcher-explore-btn"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/ai?"));
  });

  it("dismisses modal when close button is clicked", () => {
    render(<DeskMatcherQuizModal {...defaultProps} />);

    fireEvent.click(screen.getByTestId("desk-matcher-close-btn"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses modal on Escape key press", () => {
    render(<DeskMatcherQuizModal {...defaultProps} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses modal on backdrop click", () => {
    render(<DeskMatcherQuizModal {...defaultProps} />);

    const modalRoot = screen.getByTestId("desk-matcher-modal");
    fireEvent.click(modalRoot);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("merges custom className and data-testid via cn utility", () => {
    render(
      <DeskMatcherQuizModal
        {...defaultProps}
        className="custom-modal-backdrop bg-black/90"
        data-testid="custom-quiz-modal-root"
      />
    );

    const modal = screen.getByTestId("custom-quiz-modal-root");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveClass("custom-modal-backdrop");
    expect(modal).toHaveClass("bg-black/90");
  });
});
