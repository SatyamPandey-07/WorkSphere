import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import GreenLanternBatteryModal, {
  GreenLanternEmblem,
  GreenLanternRingIcon,
} from "@/components/auth/GreenLanternBatteryModal";

describe("GreenLanternBatteryModal Component", () => {
  describe("Visibility & Dialog Semantics", () => {
    it("renders nothing when isOpen is false or state is null", () => {
      const { container, rerender } = render(
        <GreenLanternBatteryModal isOpen={false} state="waiting" />,
      );
      expect(container.firstChild).toBeNull();

      rerender(<GreenLanternBatteryModal isOpen={true} state={null} />);
      expect(container.firstChild).toBeNull();
    });

    it("renders accessible dialog semantics with title and describedby linkage", () => {
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          passkeyName="Titan Security Key"
        />,
      );

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "gl-modal-title");
      expect(dialog).toHaveAttribute("aria-describedby", "gl-modal-desc");

      expect(
        screen.getByRole("heading", { name: /Biometric Battery Verification/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Verifying identity for "Titan Security Key"/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("gl-modal-desc")).toHaveTextContent(
        /Touch your fingerprint sensor, scan your face, or insert security key/i,
      );
    });
  });

  describe("Charge Meter Calculations", () => {
    it("computes default charge percentage for all lifecycle states", () => {
      const { rerender } = render(
        <GreenLanternBatteryModal isOpen={true} state="initiating" />,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "25%",
      );

      rerender(<GreenLanternBatteryModal isOpen={true} state="waiting" />);
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "65%",
      );

      rerender(<GreenLanternBatteryModal isOpen={true} state="success" />);
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "100%",
      );

      rerender(<GreenLanternBatteryModal isOpen={true} state="failed" />);
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "0%",
      );
    });

    it("supports custom chargePercentage override and clamps to 0-100", () => {
      const { rerender } = render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          chargePercentage={82}
        />,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "82%",
      );

      rerender(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          chargePercentage={145}
        />,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "100%",
      );

      rerender(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          chargePercentage={-30}
        />,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "0%",
      );

      rerender(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          chargePercentage={Number.NaN}
        />,
      );
      expect(screen.getByTestId("battery-charge-percentage")).toHaveTextContent(
        "65%",
      );
    });
  });

  describe("Dismissal & Interaction Handlers", () => {
    it("dismisses on direct backdrop click when closeOnBackdropClick is true", () => {
      const onCancel = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancel}
          closeOnBackdropClick={true}
        />,
      );

      const backdrop = screen.getByTestId("green-lantern-modal");
      fireEvent.click(backdrop);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss when clicking inside the dialog card container", () => {
      const onCancel = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancel}
        />,
      );

      const title = screen.getByRole("heading", {
        name: /Biometric Battery Verification/i,
      });
      fireEvent.click(title);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("does not dismiss on backdrop click when closeOnBackdropClick is false", () => {
      const onCancel = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancel}
          closeOnBackdropClick={false}
        />,
      );

      const backdrop = screen.getByTestId("green-lantern-modal");
      fireEvent.click(backdrop);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("dismisses on Escape key when closeOnEscape is true", () => {
      const onCancel = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancel}
          closeOnEscape={true}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("does not dismiss on Escape key when closeOnEscape is false", () => {
      const onCancel = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancel}
          closeOnEscape={false}
        />,
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("dismisses via header cancel button and fallback button", () => {
      const onCancel = jest.fn();
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="waiting"
          onCancel={onCancel}
        />,
      );

      fireEvent.click(screen.getByTestId("cancel-biometric-btn"));
      expect(onCancel).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByTestId("fallback-cancel-button"));
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
  });

  describe("Subcomponents & SVG Gradients", () => {
    it("renders GreenLanternEmblem with custom or generated idPrefix avoiding collisions", () => {
      const { rerender } = render(
        <GreenLanternEmblem state="waiting" idPrefix="custom-emblem" />,
      );

      expect(screen.getByTestId("green-lantern-emblem")).toBeInTheDocument();
      const svg = screen.getByTestId("green-lantern-emblem-svg");
      expect(svg.querySelector("#custom-emblem-emerald-grad")).toBeInTheDocument();
      expect(svg.querySelector("#custom-emblem-core-glow")).toBeInTheDocument();
      expect(svg.querySelector("#custom-emblem-glow-filter")).toBeInTheDocument();

      rerender(<GreenLanternEmblem state="success" />);
      expect(screen.getByTestId("green-shockwave")).toBeInTheDocument();
      expect(screen.getByTestId("green-shockwave-ring")).toBeInTheDocument();
    });

    it("renders GreenLanternRingIcon with custom idPrefix and reduced-motion fallback", () => {
      render(<GreenLanternRingIcon state="success" idPrefix="custom-ring" />);

      expect(screen.getByTestId("green-lantern-ring-icon")).toBeInTheDocument();
      const ringSvg = screen.getByTestId("green-lantern-ring-svg");
      expect(ringSvg.querySelector("#custom-ring-metal-band")).toBeInTheDocument();
      expect(ringSvg.querySelector("#custom-ring-face-bezel")).toBeInTheDocument();
      expect(ringSvg.querySelector("#custom-ring-core-energy")).toBeInTheDocument();

      expect(
        screen.getByTestId("hard-light-construct-flare"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("reduced-motion-fallback")).toBeInTheDocument();
    });

    it("renders error state with custom errorMessage on failure", () => {
      render(
        <GreenLanternBatteryModal
          isOpen={true}
          state="failed"
          errorMessage="Passkey assertion rejected by hardware token"
        />,
      );

      expect(screen.getByTestId("biometric-state-indicator")).toHaveTextContent(
        /Verification Failed/i,
      );
      expect(
        screen.getByText("Passkey assertion rejected by hardware token"),
      ).toBeInTheDocument();
    });
  });
});
