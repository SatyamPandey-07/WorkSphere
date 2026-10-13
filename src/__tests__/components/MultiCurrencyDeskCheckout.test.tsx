import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MultiCurrencyDeskCheckout,
  BookingCheckoutItem,
} from "@/components/billing/MultiCurrencyDeskCheckout";
import {
  createSolanaPayUrl,
  SOLANA_USDC_MINT_MAINNET,
} from "@/lib/payments/solanaPay";

describe("Solana Pay URI generation helper", () => {
  it("creates valid solana:<recipient>?amount=<amount>&spl-token=<usdc_mint> URI", () => {
    const url = createSolanaPayUrl({
      recipient: "TestRecipientWallet1111111111111111111111",
      amount: 25.5,
      splToken: SOLANA_USDC_MINT_MAINNET,
      label: "WorkSphere Desk 04 Pass",
    });

    expect(url).toContain("solana:TestRecipientWallet1111111111111111111111?");
    expect(url).toContain("amount=25.50");
    expect(url).toContain(`spl-token=${SOLANA_USDC_MINT_MAINNET}`);
    expect(url).toContain("label=WorkSphere+Desk+04+Pass");
  });
});

describe("MultiCurrencyDeskCheckout Component", () => {
  const sampleItem: BookingCheckoutItem = {
    bookingId: "booking-999",
    deskName: "Desk 04 (North Silent Window)",
    venueName: "WorkSphere SF Main",
    durationHours: 8,
    priceUsd: 45.0,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock) = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            reference: "tx_ref_test",
            status: "PENDING",
          }),
      })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("renders Solana Pay USDC QR code and deep link by default", () => {
    render(<MultiCurrencyDeskCheckout item={sampleItem} />);

    expect(screen.getByTestId("multi-currency-desk-checkout")).toBeInTheDocument();
    expect(screen.getByText("Desk 04 (North Silent Window)")).toBeInTheDocument();

    const qrCodeSvg = screen.getByTestId("solana-pay-qr-code-svg");
    expect(qrCodeSvg).toBeInTheDocument();

    const deepLinkBtn = screen.getByTestId("solana-pay-deep-link-button");
    expect(deepLinkBtn).toBeInTheDocument();
    expect(deepLinkBtn.getAttribute("href")).toContain("solana:");
    expect(deepLinkBtn.getAttribute("href")).toContain("amount=45.00");
    expect(deepLinkBtn.getAttribute("href")).toContain(`spl-token=${SOLANA_USDC_MINT_MAINNET}`);
  });

  it("polls status and triggers automatic booking confirmation upon transaction signature", async () => {
    const onBookingConfirmedMock = jest.fn();

    // Mock fetch return sequence: PENDING first, then CONFIRMED
    (global.fetch as jest.Mock)
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reference: "tx_123", status: "PENDING" }),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              reference: "tx_123",
              status: "CONFIRMED",
              signature: "5K2xMockSolanaTxSignature123456789",
            }),
        })
      );

    render(
      <MultiCurrencyDeskCheckout
        item={sampleItem}
        onBookingConfirmed={onBookingConfirmedMock}
      />
    );

    // Fast-forward polling timer 2500ms
    await act(async () => {
      jest.advanceTimersByTime(2600);
    });

    await waitFor(() => {
      expect(screen.getByTestId("solana-payment-confirmed-banner")).toBeInTheDocument();
    });

    expect(screen.getByText("Solana Payment Confirmed!")).toBeInTheDocument();

    const explorerLink = screen.getByRole("link", { name: /view on solana explorer/i });
    expect(explorerLink).toBeInTheDocument();
    expect(explorerLink).toHaveAttribute(
      "href",
      "https://explorer.solana.com/tx/5K2xMockSolanaTxSignature123456789"
    );
    expect(explorerLink).toHaveAttribute("target", "_blank");
    expect(explorerLink).toHaveAttribute("rel", "noopener noreferrer");

    expect(onBookingConfirmedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-999",
        currency: "SOL_USDC",
        amount: 45.0,
      })
    );
  });

  it("allows currency switching to traditional USD card checkout", () => {
    render(<MultiCurrencyDeskCheckout item={sampleItem} />);

    const usdTab = screen.getByTestId("currency-tab-usd");
    fireEvent.click(usdTab);

    expect(screen.getByPlaceholderText("Cardholder Name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Pay \$45.00 USD/i })
    ).toBeInTheDocument();
  });
});

describe("MultiCurrencyDeskCheckout - Satoshi Validation (#6156)", () => {
  // Import the payment streaming checkout component and validator
  const {
    MultiCurrencyDeskCheckout: MicroCheckout,
    initiateSatoshiPayment,
  } = require("@/components/payments/MultiCurrencyDeskCheckout");
  const {
    validateSatoshiAmount,
    MicroPaymentEngine,
  } = require("@/lib/payments/microPaymentEngine");

  describe("initiateSatoshiPayment validator", () => {
    it("rejects negative satoshi amounts", () => {
      expect(initiateSatoshiPayment(-1)).toBe(false);
      expect(initiateSatoshiPayment(-100)).toBe(false);
      expect(initiateSatoshiPayment(-50000)).toBe(false);
    });

    it("rejects zero satoshi amounts", () => {
      expect(initiateSatoshiPayment(0)).toBe(false);
    });

    it("rejects fractional amounts where Math.floor is less than 1", () => {
      expect(initiateSatoshiPayment(0.1)).toBe(false);
      expect(initiateSatoshiPayment(0.5)).toBe(false);
      expect(initiateSatoshiPayment(0.99)).toBe(false);
    });

    it("rejects NaN, null, undefined, and non-finite numbers", () => {
      expect(initiateSatoshiPayment(NaN)).toBe(false);
      expect(initiateSatoshiPayment(Infinity)).toBe(false);
      expect(initiateSatoshiPayment(-Infinity)).toBe(false);
      expect(initiateSatoshiPayment(null as any)).toBe(false);
      expect(initiateSatoshiPayment(undefined as any)).toBe(false);
    });

    it("accepts valid positive integer satoshi amounts (>= 1)", () => {
      expect(initiateSatoshiPayment(1)).toBe(true);
      expect(initiateSatoshiPayment(100)).toBe(true);
      expect(initiateSatoshiPayment(1460)).toBe(true);
      expect(initiateSatoshiPayment(50000)).toBe(true);
    });
  });

  describe("validateSatoshiAmount & MicroPaymentEngine.validateSats", () => {
    it("validates satoshi amounts with descriptive error messages", () => {
      const negativeResult = validateSatoshiAmount(-50);
      expect(negativeResult.isValid).toBe(false);
      expect(negativeResult.error).toContain("cannot be zero or negative");

      const zeroResult = validateSatoshiAmount(0);
      expect(zeroResult.isValid).toBe(false);
      expect(zeroResult.error).toContain("at least 1 Satoshi");

      const nanResult = validateSatoshiAmount(NaN);
      expect(nanResult.isValid).toBe(false);
      expect(nanResult.error).toContain("valid finite number");

      const validResult = validateSatoshiAmount(500);
      expect(validResult.isValid).toBe(true);
      expect(validResult.sats).toBe(500);
    });

    it("MicroPaymentEngine.validateSats validates positive integers correctly", () => {
      expect(MicroPaymentEngine.validateSats(-10)).toBe(false);
      expect(MicroPaymentEngine.validateSats(0)).toBe(false);
      expect(MicroPaymentEngine.validateSats(NaN)).toBe(false);
      expect(MicroPaymentEngine.validateSats(1)).toBe(true);
      expect(MicroPaymentEngine.validateSats(1000)).toBe(true);
    });

    it("MicroPaymentEngine.createMicroInvoice throws for non-positive satoshi amounts", () => {
      expect(() =>
        MicroPaymentEngine.createMicroInvoice("sess-1", -5.0, "lightning")
      ).toThrow("Invalid satoshi amount");
      expect(() =>
        MicroPaymentEngine.createMicroInvoice("sess-1", 0, "lightning")
      ).toThrow("Invalid satoshi amount");
    });
  });

  describe("MultiCurrencyDeskCheckout Component UI behavior", () => {
    it("displays validation warning and disables start session when negative discount makes satoshis < 1", () => {
      render(<MicroCheckout />);

      const discountInput = screen.getByTestId("custom-adjustment-input");
      expect(discountInput).toBeInTheDocument();

      // Enter a negative discount that causes net Satoshi balance to drop <= 0
      fireEvent.change(discountInput, { target: { value: "-5.00" } });

      const warning = screen.getByTestId("satoshi-validation-error");
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent(/at least 1 Satoshi/i);

      // Verify the start button is disabled
      const startBtn = screen.getByTestId("start-session-button");
      expect(startBtn).toBeDisabled();
    });

    it("clears validation error and enables button when a valid adjustment is provided", () => {
      render(<MicroCheckout />);

      const discountInput = screen.getByTestId("custom-adjustment-input");

      // Enter negative discount first
      fireEvent.change(discountInput, { target: { value: "-10.00" } });
      expect(screen.getByTestId("satoshi-validation-error")).toBeInTheDocument();

      // Fix with a positive gratuity
      fireEvent.change(discountInput, { target: { value: "2.50" } });
      expect(screen.queryByTestId("satoshi-validation-error")).not.toBeInTheDocument();

      const startBtn = screen.getByTestId("start-session-button");
      expect(startBtn).not.toBeDisabled();
    });
  });
});

