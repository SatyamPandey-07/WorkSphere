import React, { act } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  BFTConsensusDashboard,
  CopyButton,
  copyText,
  fallbackCopyTextToClipboard,
} from "@/components/admin/BFTConsensusDashboard";
import {
  BFTConsensusCoordinator,
  createTestValidatorKeySet,
} from "@/core/consensus/BFTConsensusCoordinator";

describe("BFTConsensusDashboard Copy-to-Clipboard (Issue #10113)", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;
  const mockWriteText = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: mockWriteText.mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
    document.execCommand = jest.fn().mockReturnValue(true);
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
  });

  describe("CopyButton & Clipboard Logic", () => {
    it("copies a proposal hash complete hexadecimal string using navigator.clipboard", async () => {
      const fullHexHash =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      render(
        <CopyButton
          value={fullHexHash}
          label="proposal transaction hash"
          testId="copy-hash-test"
        />,
      );

      const button = screen.getByTestId("copy-hash-test");
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute(
        "aria-label",
        "Copy proposal transaction hash",
      );

      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockWriteText).toHaveBeenCalledWith(fullHexHash);
      await waitFor(() => {
        expect(button).toHaveAttribute(
          "aria-label",
          "Copied proposal transaction hash",
        );
      });
    });

    it("copies a sequence number complete string value", async () => {
      render(
        <CopyButton
          value={42}
          label="sequence number"
          testId="copy-seq-test"
        />,
      );

      const button = screen.getByTestId("copy-seq-test");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockWriteText).toHaveBeenCalledWith("42");
      await waitFor(() => {
        expect(button).toHaveAttribute("aria-label", "Copied sequence number");
      });
    });

    it("copies a parent hash complete value", async () => {
      const fullParentHash =
        "0000000000000000000000000000000000000000000000000000000000000000";
      render(
        <CopyButton
          value={fullParentHash}
          label="parent hash"
          testId="copy-parent-test"
        />,
      );

      const button = screen.getByTestId("copy-parent-test");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(mockWriteText).toHaveBeenCalledWith(fullParentHash);
      await waitFor(() => {
        expect(button).toHaveAttribute("aria-label", "Copied parent hash");
      });
    });

    it("handles clipboard API failures gracefully without reporting false success", async () => {
      mockWriteText.mockRejectedValueOnce(
        new Error("Clipboard permission denied"),
      );
      document.execCommand = jest.fn().mockReturnValue(false);
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      render(
        <CopyButton
          value="sample-hash"
          label="proposal transaction hash"
          testId="copy-fail-test"
        />,
      );

      const button = screen.getByTestId("copy-fail-test");
      await act(async () => {
        fireEvent.click(button);
      });

      await waitFor(() => {
        expect(button).toHaveAttribute(
          "aria-label",
          "Failed to copy proposal transaction hash",
        );
      });

      consoleErrorSpy.mockRestore();
    });

    it("uses document.execCommand fallback when navigator.clipboard is unavailable", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const execCommandMock = jest.fn().mockReturnValue(true);
      document.execCommand = execCommandMock;

      const fullHash =
        "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
      render(
        <CopyButton
          value={fullHash}
          label="proposal transaction hash"
          testId="copy-fallback-test"
        />,
      );

      const button = screen.getByTestId("copy-fallback-test");
      await act(async () => {
        fireEvent.click(button);
      });

      expect(execCommandMock).toHaveBeenCalledWith("copy");
      await waitFor(() => {
        expect(button).toHaveAttribute(
          "aria-label",
          "Copied proposal transaction hash",
        );
      });
    });

    it("cleans up DOM textarea element in fallbackCopyTextToClipboard", () => {
      const appendChildSpy = jest.spyOn(document.body, "appendChild");
      const removeChildSpy = jest.spyOn(document.body, "removeChild");
      document.execCommand = jest.fn().mockReturnValue(true);

      const success = fallbackCopyTextToClipboard("cleanup-test-text");

      expect(success).toBe(true);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();

      appendChildSpy.mockRestore();
      removeChildSpy.mockRestore();
    });

    it("copyText handles undefined navigator safely", async () => {
      const res = await copyText("text-val");
      expect(typeof res).toBe("boolean");
    });
  });

  describe("BFTConsensusDashboard Integration", () => {
    const validators = ["node-0", "node-1", "node-2", "node-3"];
    const keySet = createTestValidatorKeySet(validators);

    function createCoordinator(): BFTConsensusCoordinator {
      return new BFTConsensusCoordinator({
        nodeId: "node-0",
        validators,
        validatorPublicKeys: keySet.publicKeys,
        signer: keySet.signers["node-0"],
      });
    }

    it("renders proposal hashes, sequence numbers, and parent hashes with copy buttons", async () => {
      const coordinator = createCoordinator();

      // Propose a block as leader (node-0)
      const proposal = coordinator.propose(
        { txId: "tx-test-12345", amount: 100 },
        "0000000000000000000000000000000000000000000000000000000000000000",
      );

      render(
        <BFTConsensusDashboard
          coordinator={coordinator}
          autoRefreshIntervalMs={0}
        />,
      );

      expect(screen.getByText("BFT Consensus Diagnostics")).toBeInTheDocument();
      expect(screen.getByTestId("proposals-table")).toBeInTheDocument();

      // Verify proposal hash copy button
      const hashCopyBtn = screen.getByTestId(
        `copy-proposal-hash-${proposal.sequence}-btn`,
      );
      expect(hashCopyBtn).toBeInTheDocument();
      expect(hashCopyBtn).toHaveAttribute("type", "button");
      expect(hashCopyBtn).toHaveAttribute(
        "aria-label",
        "Copy proposal transaction hash",
      );

      await act(async () => {
        fireEvent.click(hashCopyBtn);
      });
      expect(mockWriteText).toHaveBeenCalledWith(proposal.blockHash);

      // Verify sequence copy button
      const seqCopyBtn = screen.getByTestId(
        `copy-seq-${proposal.sequence}-btn`,
      );
      expect(seqCopyBtn).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(seqCopyBtn);
      });
      expect(mockWriteText).toHaveBeenCalledWith(String(proposal.sequence));

      // Verify parent hash copy button
      const parentCopyBtn = screen.getByTestId(
        `copy-parent-hash-${proposal.sequence}-btn`,
      );
      expect(parentCopyBtn).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(parentCopyBtn);
      });
      expect(mockWriteText).toHaveBeenCalledWith(proposal.parentHash);
    });

    it("renders empty state gracefully when no blocks exist", () => {
      const coordinator = createCoordinator();
      render(
        <BFTConsensusDashboard
          coordinator={coordinator}
          autoRefreshIntervalMs={0}
        />,
      );

      expect(
        screen.getByText("No proposals or blocks recorded yet."),
      ).toBeInTheDocument();
    });
  });
});
