/**
 * Tests for venue booking task automation and workflow triggers.
 */

type TriggerEvent = "booking_created" | "booking_confirmed" | "checkin" | "checkout" | "payment_received" | "cancellation";
type ActionType = "send_email" | "create_task" | "update_crm" | "send_notification" | "generate_invoice";

interface AutomationRule {
  id: string;
  name: string;
  trigger: TriggerEvent;
  conditions: { field: string; operator: "eq" | "gt" | "lt" | "contains"; value: string | number }[];
  actions: ActionType[];
  isActive: boolean;
  priority: number;
}

interface AutomationEvent {
  type: TriggerEvent;
  payload: Record<string, string | number>;
  timestamp: number;
}

function matchesCondition(
  condition: AutomationRule["conditions"][0],
  payload: Record<string, string | number>
): boolean {
  const fieldValue = payload[condition.field];
  if (fieldValue === undefined) return false;
  switch (condition.operator) {
    case "eq": return fieldValue === condition.value;
    case "gt": return typeof fieldValue === "number" && typeof condition.value === "number" && fieldValue > condition.value;
    case "lt": return typeof fieldValue === "number" && typeof condition.value === "number" && fieldValue < condition.value;
    case "contains": return String(fieldValue).includes(String(condition.value));
  }
}

function ruleApplies(rule: AutomationRule, event: AutomationEvent): boolean {
  if (!rule.isActive) return false;
  if (rule.trigger !== event.type) return false;
  return rule.conditions.every((c) => matchesCondition(c, event.payload));
}

function activeRulesForTrigger(rules: AutomationRule[], trigger: TriggerEvent): AutomationRule[] {
  return rules.filter((r) => r.isActive && r.trigger === trigger).sort((a, b) => a.priority - b.priority);
}

function actionsForEvent(rules: AutomationRule[], event: AutomationEvent): ActionType[] {
  const matched = rules.filter((r) => ruleApplies(r, event));
  const allActions = matched.flatMap((r) => r.actions);
  return [...new Set(allActions)];
}

const RULES: AutomationRule[] = [
  {
    id: "r1", name: "Invoice on payment", trigger: "payment_received",
    conditions: [{ field: "amount", operator: "gt", value: 500 }],
    actions: ["generate_invoice", "send_email"], isActive: true, priority: 1,
  },
  {
    id: "r2", name: "Welcome on booking", trigger: "booking_confirmed",
    conditions: [],
    actions: ["send_email", "update_crm"], isActive: true, priority: 2,
  },
  {
    id: "r3", name: "Inactive rule", trigger: "checkin",
    conditions: [],
    actions: ["send_notification"], isActive: false, priority: 1,
  },
];

const NOW = 1_700_000_000_000;

describe("Task automation and workflow triggers", () => {
  it("matchesCondition: amount 600 > 500 → true", () => {
    const cond = { field: "amount", operator: "gt" as const, value: 500 };
    expect(matchesCondition(cond, { amount: 600 })).toBe(true);
  });

  it("ruleApplies: r1 with amount=600 → true", () => {
    const event: AutomationEvent = { type: "payment_received", payload: { amount: 600 }, timestamp: NOW };
    expect(ruleApplies(RULES[0], event)).toBe(true);
  });

  it("ruleApplies: r1 with amount=300 → false (condition not met)", () => {
    const event: AutomationEvent = { type: "payment_received", payload: { amount: 300 }, timestamp: NOW };
    expect(ruleApplies(RULES[0], event)).toBe(false);
  });

  it("ruleApplies: inactive rule → false", () => {
    const event: AutomationEvent = { type: "checkin", payload: {}, timestamp: NOW };
    expect(ruleApplies(RULES[2], event)).toBe(false);
  });

  it("activeRulesForTrigger: 1 active rule for payment_received", () => {
    expect(activeRulesForTrigger(RULES, "payment_received").length).toBe(1);
  });

  it("actionsForEvent: booking_confirmed → email and crm", () => {
    const event: AutomationEvent = { type: "booking_confirmed", payload: {}, timestamp: NOW };
    const actions = actionsForEvent(RULES, event);
    expect(actions).toContain("send_email");
    expect(actions).toContain("update_crm");
  });
});
