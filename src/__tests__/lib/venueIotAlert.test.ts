/**
 * Tests for venue IoT alert threshold management.
 */

type AlertSeverity = "info" | "warning" | "critical";

interface SensorThreshold {
  sensorType: string;
  warningMin?: number;
  warningMax?: number;
  criticalMin?: number;
  criticalMax?: number;
}

interface SensorAlert {
  sensorId: string;
  sensorType: string;
  value: number;
  severity: AlertSeverity;
  message: string;
  triggeredAt: number;
  acknowledged: boolean;
}

function evaluateThreshold(
  sensorType: string,
  value: number,
  threshold: SensorThreshold
): AlertSeverity | null {
  if (threshold.criticalMin !== undefined && value < threshold.criticalMin) return "critical";
  if (threshold.criticalMax !== undefined && value > threshold.criticalMax) return "critical";
  if (threshold.warningMin !== undefined && value < threshold.warningMin) return "warning";
  if (threshold.warningMax !== undefined && value > threshold.warningMax) return "warning";
  return null;
}

function acknowledgeAlert(alert: SensorAlert, nowMs: number): SensorAlert {
  return { ...alert, acknowledged: true };
}

function activeAlerts(alerts: SensorAlert[]): SensorAlert[] {
  return alerts.filter((a) => !a.acknowledged);
}

function criticalAlerts(alerts: SensorAlert[]): SensorAlert[] {
  return alerts.filter((a) => a.severity === "critical" && !a.acknowledged);
}

const CO2_THRESHOLD: SensorThreshold = {
  sensorType: "co2",
  warningMin: undefined, warningMax: 800,
  criticalMin: undefined, criticalMax: 1200,
};

const NOW = 1_700_000_000_000;
const ALERTS: SensorAlert[] = [
  { sensorId: "s1", sensorType: "co2", value: 900, severity: "warning",  message: "CO2 elevated", triggeredAt: NOW - 1000, acknowledged: false },
  { sensorId: "s2", sensorType: "co2", value: 1300,severity: "critical", message: "CO2 critical", triggeredAt: NOW - 500,  acknowledged: false },
  { sensorId: "s3", sensorType: "temp",value: 25,  severity: "info",     message: "Temp normal",  triggeredAt: NOW - 200,  acknowledged: true  },
];

describe("Venue IoT alert management", () => {
  it("evaluateThreshold: 900 > 800 warning max → warning", () => {
    expect(evaluateThreshold("co2", 900, CO2_THRESHOLD)).toBe("warning");
  });

  it("evaluateThreshold: 1300 > 1200 critical max → critical", () => {
    expect(evaluateThreshold("co2", 1300, CO2_THRESHOLD)).toBe("critical");
  });

  it("evaluateThreshold: 500 within limits → null", () => {
    expect(evaluateThreshold("co2", 500, CO2_THRESHOLD)).toBeNull();
  });

  it("acknowledgeAlert: sets acknowledged = true", () => {
    const ack = acknowledgeAlert(ALERTS[0], NOW);
    expect(ack.acknowledged).toBe(true);
  });

  it("acknowledgeAlert is immutable", () => {
    acknowledgeAlert(ALERTS[0], NOW);
    expect(ALERTS[0].acknowledged).toBe(false);
  });

  it("activeAlerts: returns unacknowledged", () => {
    expect(activeAlerts(ALERTS)).toHaveLength(2);
  });

  it("criticalAlerts: 1 unacknowledged critical", () => {
    expect(criticalAlerts(ALERTS)).toHaveLength(1);
    expect(criticalAlerts(ALERTS)[0].value).toBe(1300);
  });
});
