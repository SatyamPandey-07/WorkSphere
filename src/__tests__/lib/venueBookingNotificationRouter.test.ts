/**
 * Tests for venue booking notification routing and priority engine.
 */

type NotificationType =
  | "booking_confirmed"
  | "booking_cancelled"
  | "payment_due"
  | "review_request"
  | "promo_offer"
  | "system_alert";

type Channel = "push" | "email" | "sms" | "in_app";

interface NotificationRule {
  type: NotificationType;
  channels: Channel[];
  priority: "critical" | "high" | "medium" | "low";
  sendImmediately: boolean;
  maxRetries: number;
}

const RULES: Record<NotificationType, NotificationRule> = {
  booking_confirmed: { type: "booking_confirmed", channels: ["push", "email"],      priority: "high",     sendImmediately: true,  maxRetries: 3 },
  booking_cancelled: { type: "booking_cancelled", channels: ["push", "email", "sms"],priority: "critical",sendImmediately: true,  maxRetries: 5 },
  payment_due:       { type: "payment_due",        channels: ["email", "sms"],       priority: "high",     sendImmediately: false, maxRetries: 3 },
  review_request:    { type: "review_request",     channels: ["email", "in_app"],    priority: "low",      sendImmediately: false, maxRetries: 1 },
  promo_offer:       { type: "promo_offer",        channels: ["email", "in_app"],    priority: "low",      sendImmediately: false, maxRetries: 1 },
  system_alert:      { type: "system_alert",       channels: ["push", "email"],      priority: "critical", sendImmediately: true,  maxRetries: 5 },
};

function routeNotification(type: NotificationType): NotificationRule {
  return RULES[type];
}

function isCritical(type: NotificationType): boolean {
  return RULES[type].priority === "critical";
}

function notificationsByChannel(channel: Channel): NotificationType[] {
  return (Object.values(RULES) as NotificationRule[])
    .filter((r) => r.channels.includes(channel))
    .map((r) => r.type);
}

function highPriorityNotifications(): NotificationType[] {
  return (Object.values(RULES) as NotificationRule[])
    .filter((r) => r.priority === "critical" || r.priority === "high")
    .map((r) => r.type);
}

function maxRetriesTotalForCritical(): number {
  return (Object.values(RULES) as NotificationRule[])
    .filter((r) => r.priority === "critical")
    .reduce((s, r) => s + r.maxRetries, 0);
}

describe("Notification routing engine", () => {
  it("routeNotification: booking_confirmed has push and email", () => {
    const rule = routeNotification("booking_confirmed");
    expect(rule.channels).toContain("push");
    expect(rule.channels).toContain("email");
  });

  it("isCritical: booking_cancelled → true", () => {
    expect(isCritical("booking_cancelled")).toBe(true);
  });

  it("isCritical: promo_offer → false", () => {
    expect(isCritical("promo_offer")).toBe(false);
  });

  it("notificationsByChannel: SMS gets payment_due and booking_cancelled", () => {
    const via = notificationsByChannel("sms");
    expect(via).toContain("booking_cancelled");
    expect(via).toContain("payment_due");
  });

  it("highPriorityNotifications: includes 4 types", () => {
    expect(highPriorityNotifications().length).toBe(4);
  });

  it("maxRetriesTotalForCritical: 10 total retries", () => {
    expect(maxRetriesTotalForCritical()).toBe(10);
  });
});
