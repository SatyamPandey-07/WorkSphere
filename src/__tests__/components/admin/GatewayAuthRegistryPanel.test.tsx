import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  buildSanitizedGatewayCurlSnippet,
  GATEWAY_TOKEN_PLACEHOLDER,
  GatewayAuthRegistryPanel,
} from "@/components/admin/GatewayAuthRegistryPanel";
import type { GatewayCredentialRecord } from "@/lib/telemetry/gatewayAuthRegistry";

describe("GatewayAuthRegistryPanel copyable curl snippet", () => {
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  it("builds a sanitized curl snippet with placeholder token and escapes single quotes", () => {
    const snippet = buildSanitizedGatewayCurlSnippet({
      gatewayId: "gw-mum-'01",
      keyId: "key-v1",
      venueId: "venue-bandra",
      baseUrl: "https://worksphere.example.com/",
    });

    expect(snippet).toContain(
      "POST 'https://worksphere.example.com/api/telemetry/batch'",
    );
    expect(snippet).toContain(
      `Authorization: Bearer ${GATEWAY_TOKEN_PLACEHOLDER}`,
    );
    expect(snippet).toContain("x-gateway-id: gw-mum-'\\''01");
    expect(snippet).toContain("x-gateway-key-id: key-v1");
    expect(snippet).toContain('"venueId":"venue-bandra"');
  });

  it("never embeds raw secret tokens in the DOM or copied snippet", async () => {
    const rawSecret = "whsec_live_super_secret_raw_token_99999";
    const enrolledGateway: GatewayCredentialRecord = {
      gatewayId: "gw-hyd-01",
      keyId: "key-2026-01",
      secretOrVerifier: rawSecret,
      scopes: ["telemetry:metrics:write"],
      status: "active",
      issuedAtMs: 1_700_000_000_000,
    };

    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    jest.useFakeTimers();

    const { container } = render(
      <GatewayAuthRegistryPanel
        gateways={[enrolledGateway]}
        baseUrl="https://worksphere.app"
        defaultVenueId="venue-hyd"
        copiedFeedbackMs={1500}
      />,
    );

    expect(container.innerHTML).not.toContain(rawSecret);
    expect(container.textContent).not.toContain(rawSecret);

    const codeBlock = screen.getByTestId("gateway-curl-gw-hyd-01");
    expect(codeBlock).toHaveTextContent(GATEWAY_TOKEN_PLACEHOLDER);
    expect(codeBlock).toHaveTextContent("gw-hyd-01");
    expect(codeBlock).toHaveTextContent("key-2026-01");

    const copyBtn = screen.getByRole("button", {
      name: /copy curl verification snippet for gw-hyd-01/i,
    });
    expect(copyBtn).toHaveTextContent("Copy curl");

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    const copiedText = writeTextMock.mock.calls[0][0] as string;
    expect(copiedText).toContain(GATEWAY_TOKEN_PLACEHOLDER);
    expect(copiedText).not.toContain(rawSecret);
    expect(
      screen.getByRole("button", {
        name: /copied curl verification snippet for gw-hyd-01/i,
      }),
    ).toHaveTextContent("Copied");

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(
      screen.getByRole("button", {
        name: /copy curl verification snippet for gw-hyd-01/i,
      }),
    ).toHaveTextContent("Copy curl");
  });

  it("handles clipboard unavailability without throwing unhandled rejections", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });

    render(
      <GatewayAuthRegistryPanel
        gateways={[
          {
            gatewayId: "gw-blr-02",
            keyId: "key-v2",
            scopes: [],
            status: "grace",
            issuedAtMs: 1_700_000_000_000,
          },
        ]}
      />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", {
          name: /copy curl verification snippet for gw-blr-02/i,
        }),
      );
    });

    expect(
      screen.getByRole("button", {
        name: /copy curl verification snippet failed for gw-blr-02/i,
      }),
    ).toHaveTextContent("Copy unavailable");
  });
});
