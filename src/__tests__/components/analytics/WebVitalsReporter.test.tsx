import { render } from "@testing-library/react";
import { WebVitalsReporter } from "@/components/analytics/WebVitalsReporter";

const mockStartReporter = jest.fn();
const mockSetConsent = jest.fn();
const mockStopReporter = jest.fn();

jest.mock("@/lib/telemetry/webVitalsReporter", () => ({
  DEFAULT_WEB_VITALS_SAMPLE_RATE: 0.2,
  WEB_VITALS_CONSENT_KEY: "worksphere-cookie-consent",
  startWebVitalsReporter: (...args: unknown[]) => mockStartReporter(...args),
  stopWebVitalsReporter: () => mockStopReporter(),
  setWebVitalsConsent: (...args: unknown[]) => mockSetConsent(...args),
}));

describe("WebVitalsReporter component", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStartReporter.mockReset();
    mockSetConsent.mockReset();
    mockStopReporter.mockReset();
  });

  it("initializes the singleton reporter after stored consent is granted", () => {
    localStorage.setItem("worksphere-cookie-consent", "granted");

    const { container } = render(<WebVitalsReporter />);

    expect(container.firstChild).toBeNull();
    expect(mockSetConsent).toHaveBeenCalledWith(true);
    expect(mockStartReporter).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "/api/telemetry/vitals",
        enabled: true,
        samplingRate: 0.2,
      }),
    );
  });

  it("waits for consent, then responds to acceptance and withdrawal", () => {
    render(<WebVitalsReporter />);
    expect(mockStartReporter).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("worksphere:cookie-consent", { detail: "granted" }),
    );
    expect(mockSetConsent).toHaveBeenLastCalledWith(true);
    expect(mockStartReporter).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new CustomEvent("worksphere:cookie-consent", { detail: "declined" }),
    );
    expect(mockSetConsent).toHaveBeenLastCalledWith(false);
  });

  it("removes consent listeners when unmounted", () => {
    const { unmount } = render(<WebVitalsReporter />);
    unmount();
    window.dispatchEvent(
      new CustomEvent("worksphere:cookie-consent", { detail: "granted" }),
    );

    expect(mockStartReporter).not.toHaveBeenCalled();
    expect(mockStopReporter).toHaveBeenCalledTimes(1);
  });

  it("passes disabled and configured sampling options to the reporter", () => {
    localStorage.setItem("worksphere-cookie-consent", "granted");
    render(
      <WebVitalsReporter
        enabled={false}
        endpoint="/custom"
        samplingRate={0.75}
      />,
    );

    expect(mockStartReporter).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        endpoint: "/custom",
        samplingRate: 0.75,
      }),
    );
  });
});
