describe("Logger utilities for venue booking", () => {
  type Level = "debug" | "info" | "warn" | "error";
  const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  function shouldLog(messageLevel: Level, minLevel: Level): boolean {
    return LEVELS[messageLevel] >= LEVELS[minLevel];
  }
  function formatLog(level: Level, message: string, context?: Record<string, unknown>): string {
    const ctx = context ? ` ${JSON.stringify(context)}` : "";
    return `[${level.toUpperCase()}] ${message}${ctx}`;
  }
  function redactSensitive(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const result = { ...obj };
    for (const k of keys) if (k in result) result[k] = "***REDACTED***";
    return result;
  }
  it("error always logs", () => { expect(shouldLog("error", "warn")).toBe(true); });
  it("debug blocked at info level", () => { expect(shouldLog("debug", "info")).toBe(false); });
  it("formatLog includes level", () => { expect(formatLog("info", "test")).toBe("[INFO] test"); });
  it("formatLog includes context", () => {
    expect(formatLog("warn", "msg", {id:"1"})).toContain('"id":"1"');
  });
  it("redactSensitive hides password", () => {
    const r = redactSensitive({user:"bob",password:"secret"}, ["password"]);
    expect(r.password).toBe("***REDACTED***");
    expect(r.user).toBe("bob");
  });
});
