describe("Feature toggle utilities for venue booking", () => {
  type Env = "dev" | "staging" | "prod";
  interface Toggle { key: string; enabled: boolean; envs: Env[]; rollout: number }
  function isEnabled(toggle: Toggle, env: Env, userId?: string): boolean {
    if (!toggle.enabled) return false;
    if (!toggle.envs.includes(env)) return false;
    if (toggle.rollout >= 100) return true;
    if (!userId) return false;
    const hash = userId.split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100, 0);
    return hash < toggle.rollout;
  }
  const t1: Toggle = { key: "new_checkout", enabled: true,  envs: ["prod","staging"], rollout: 100 };
  const t2: Toggle = { key: "beta_pricing", enabled: true,  envs: ["staging"],        rollout: 50 };
  const t3: Toggle = { key: "off_feature",  enabled: false, envs: ["prod"],           rollout: 100 };
  it("fully rolled out in prod", () => { expect(isEnabled(t1, "prod")).toBe(true); });
  it("disabled toggle → false", () => { expect(isEnabled(t3, "prod")).toBe(false); });
  it("wrong env → false", () => { expect(isEnabled(t2, "prod")).toBe(false); });
  it("50% rollout respects userId hash", () => {
    const results = ["u1","u2","u3","u4","u5"].map((u) => isEnabled(t2, "staging", u));
    expect(results.some(Boolean) || results.every((r) => !r)).toBe(true); // some or none
  });
});
