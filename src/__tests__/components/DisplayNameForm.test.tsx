import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  DisplayNameForm,
  CALLSIGN_STORAGE_KEY,
} from "@/components/profile/DisplayNameForm";

describe("DisplayNameForm - Test Pilot Callsign & Live Preview (#6172)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  describe("Field Rendering & Attributes", () => {
    it("renders flight callsign input field with 20 character maximum", () => {
      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      const callsignInput = screen.getByTestId("callsign-input");
      expect(callsignInput).toBeInTheDocument();
      expect(callsignInput).toHaveAttribute("maxLength", "20");
      expect(callsignInput).toHaveAttribute(
        "placeholder",
        "e.g. Highball, Maverick, Emerald",
      );
      expect(screen.getByLabelText(/Flight Callsign \(Optional\)/i)).toBe(
        callsignInput,
      );
      expect(screen.getByTestId("callsign-char-count")).toHaveTextContent("8/20");
    });

    it("renders live preview card container and leaderboard title", () => {
      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      expect(screen.getByTestId("callsign-preview-card")).toBeInTheDocument();
      expect(
        screen.getByText(/Community Leaderboard Preview/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Live Preview/i)).toBeInTheDocument();
    });
  });

  describe("Live Preview Card Formatting", () => {
    it('formats initial name and callsign as: Hal "Highball" Jordan', () => {
      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent('Hal "Highball" Jordan');

      const badge = screen.getByTestId("callsign-preview-badge");
      expect(badge).toHaveTextContent("✈ HIGHBALL");
    });

    it("updates live preview card in real time as user types in callsign input", () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent("Hal Jordan");
      expect(screen.queryByTestId("callsign-preview-badge")).not.toBeInTheDocument();

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "Maverick" } });

      expect(screen.getByTestId("callsign-char-count")).toHaveTextContent("8/20");
      expect(previewName).toHaveTextContent('Hal "Maverick" Jordan');
      expect(screen.getByTestId("callsign-preview-badge")).toHaveTextContent(
        "✈ MAVERICK",
      );

      // Change to Emerald
      fireEvent.change(callsignInput, { target: { value: "Emerald" } });
      expect(previewName).toHaveTextContent('Hal "Emerald" Jordan');
      expect(screen.getByTestId("callsign-preview-badge")).toHaveTextContent(
        "✈ EMERALD",
      );
    });

    it("updates live preview card in real time as user changes display name", () => {
      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      const displayNameInput = screen.getByTestId("display-name-input");
      fireEvent.change(displayNameInput, {
        target: { value: "Pete Mitchell" },
      });

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent('Pete "Highball" Mitchell');
    });

    it("handles single-word display name by appending quoted callsign", () => {
      render(
        <DisplayNameForm initialDisplayName="Hal" initialCallsign="Highball" />,
      );

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent('Hal "Highball"');
    });

    it("handles multi-word display name inserting callsign between first and remaining names", () => {
      render(
        <DisplayNameForm
          initialDisplayName="Hal Bob Jordan"
          initialCallsign="Highball"
        />,
      );

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent('Hal "Highball" Bob Jordan');
    });

    it("removes quotes and badge when user clears callsign", () => {
      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "" } });

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent("Hal Jordan");
      expect(screen.queryByTestId("callsign-preview-badge")).not.toBeInTheDocument();
    });
  });

  describe("Input Validation (Alphanumeric & Hyphens)", () => {
    it("accepts valid alphanumeric characters and hyphens without error", () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "RAPTOR-01" } });

      expect(screen.queryByTestId("callsign-error")).not.toBeInTheDocument();
    });

    it("displays validation error when special characters are typed", () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "Maverick!" } });

      const error = screen.getByTestId("callsign-error");
      expect(error).toBeInTheDocument();
      expect(error).toHaveTextContent(
        "Callsign can only contain alphanumeric characters and hyphens.",
      );
    });

    it("displays validation error when spaces are typed", () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "Top Gun" } });

      const error = screen.getByTestId("callsign-error");
      expect(error).toBeInTheDocument();
      expect(error).toHaveTextContent(
        "Callsign can only contain alphanumeric characters and hyphens.",
      );
    });

    it("displays validation error when underscores or at-symbols are typed", () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "pilot_2814" } });

      expect(screen.getByTestId("callsign-error")).toBeInTheDocument();

      fireEvent.change(callsignInput, { target: { value: "lantern@green" } });
      expect(screen.getByTestId("callsign-error")).toBeInTheDocument();
    });

    it("clears error message when invalid input is corrected", () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "Maverick!" } });
      expect(screen.getByTestId("callsign-error")).toBeInTheDocument();

      fireEvent.change(callsignInput, { target: { value: "Maverick" } });
      expect(screen.queryByTestId("callsign-error")).not.toBeInTheDocument();
    });

    it("prevents form submission when callsign validation fails", async () => {
      render(<DisplayNameForm initialDisplayName="Hal Jordan" />);

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "Invalid#Callsign" } });

      const submitBtn = screen.getByTestId("save-display-name-button");
      fireEvent.click(submitBtn);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByTestId("callsign-error")).toBeInTheDocument();
    });

    it("prevents form submission when display name validation fails", async () => {
      render(<DisplayNameForm initialDisplayName="" />);

      const submitBtn = screen.getByTestId("save-display-name-button");
      fireEvent.click(submitBtn);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(screen.getByTestId("display-name-error")).toBeInTheDocument();
    });
  });

  describe("Form Submission & Persistence", () => {
    it("submits PATCH with sanitized display name and callsign, storing in localStorage", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const onSaveSuccess = jest.fn();
      const dispatchSpy = jest.spyOn(window, "dispatchEvent");

      render(
        <DisplayNameForm
          initialDisplayName="   Hal    Jordan   "
          initialCallsign="   Highball   "
          onSaveSuccess={onSaveSuccess}
        />,
      );

      const submitBtn = screen.getByTestId("save-display-name-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/user/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: "Hal Jordan",
            callsign: "Highball",
          }),
        });
      });

      await waitFor(() => {
        expect(localStorage.getItem(CALLSIGN_STORAGE_KEY)).toBe("Highball");
        expect(onSaveSuccess).toHaveBeenCalledWith("Hal Jordan", "Highball");
        expect(screen.getByTestId("display-name-success")).toBeInTheDocument();
        expect(dispatchSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "worksphere_flight_callsign_change",
            detail: "Highball",
          }),
        );
      });
    });

    it("loads saved callsign from localStorage on initial render if prop is omitted", () => {
      localStorage.setItem(CALLSIGN_STORAGE_KEY, "Emerald");

      render(<DisplayNameForm initialDisplayName="John Stewart" />);

      const callsignInput = screen.getByTestId("callsign-input");
      expect(callsignInput).toHaveValue("Emerald");

      const previewName = screen.getByTestId("callsign-preview-name");
      expect(previewName).toHaveTextContent('John "Emerald" Stewart');
    });

    it("removes callsign from localStorage if cleared and saved", async () => {
      localStorage.setItem(CALLSIGN_STORAGE_KEY, "Highball");
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      const callsignInput = screen.getByTestId("callsign-input");
      fireEvent.change(callsignInput, { target: { value: "" } });

      const submitBtn = screen.getByTestId("save-display-name-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(localStorage.getItem(CALLSIGN_STORAGE_KEY)).toBeNull();
      });
    });


    it("displays error message if server PATCH fails", async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Server rate limit exceeded" }),
      });

      render(
        <DisplayNameForm
          initialDisplayName="Hal Jordan"
          initialCallsign="Highball"
        />,
      );

      const submitBtn = screen.getByTestId("save-display-name-button");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId("display-name-error")).toHaveTextContent(
          "Server rate limit exceeded",
        );
      });
    });
  });
});
