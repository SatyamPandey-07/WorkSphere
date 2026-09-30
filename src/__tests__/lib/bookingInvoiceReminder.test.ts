/**
 * Tests for overdue invoice reminder scheduling.
 */

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

interface Invoice {
  invoiceId: string;
  userId: string;
  amountCents: number;
  dueDate: string;   // YYYY-MM-DD
  status: InvoiceStatus;
  lastReminderAt: number | null;
  reminderCount: number;
}

function isOverdue(invoice: Invoice, todayStr: string): boolean {
  return invoice.status !== "paid" && invoice.status !== "cancelled" && invoice.dueDate < todayStr;
}

function daysPastDue(invoice: Invoice, todayStr: string): number {
  if (!isOverdue(invoice, todayStr)) return 0;
  const due = new Date(invoice.dueDate).getTime();
  const today = new Date(todayStr).getTime();
  return Math.floor((today - due) / 86_400_000);
}

function shouldSendReminder(
  invoice: Invoice,
  todayStr: string,
  nowMs: number,
  maxReminders = 3,
  intervalMs = 3 * 86_400_000
): boolean {
  if (!isOverdue(invoice, todayStr)) return false;
  if (invoice.reminderCount >= maxReminders) return false;
  if (!invoice.lastReminderAt) return true;
  return nowMs - invoice.lastReminderAt >= intervalMs;
}

function markReminderSent(invoice: Invoice, nowMs: number): Invoice {
  return { ...invoice, lastReminderAt: nowMs, reminderCount: invoice.reminderCount + 1, status: "overdue" };
}

const NOW = 1_700_000_000_000;
const TODAY = new Date(NOW).toISOString().split("T")[0];
const OVERDUE_INVOICE: Invoice = {
  invoiceId: "inv1", userId: "u1", amountCents: 10000,
  dueDate: new Date(NOW - 5 * 86_400_000).toISOString().split("T")[0], // 5 days ago
  status: "sent", lastReminderAt: null, reminderCount: 0,
};

describe("Booking invoice reminders", () => {
  it("isOverdue: past due → true", () => {
    expect(isOverdue(OVERDUE_INVOICE, TODAY)).toBe(true);
  });

  it("isOverdue: paid → false", () => {
    expect(isOverdue({ ...OVERDUE_INVOICE, status: "paid" }, TODAY)).toBe(false);
  });

  it("daysPastDue: 5 days past", () => {
    expect(daysPastDue(OVERDUE_INVOICE, TODAY)).toBe(5);
  });

  it("daysPastDue: not overdue → 0", () => {
    expect(daysPastDue({ ...OVERDUE_INVOICE, status: "paid" }, TODAY)).toBe(0);
  });

  it("shouldSendReminder: overdue and no reminders → true", () => {
    expect(shouldSendReminder(OVERDUE_INVOICE, TODAY, NOW)).toBe(true);
  });

  it("shouldSendReminder: max reminders reached → false", () => {
    const maxed = { ...OVERDUE_INVOICE, reminderCount: 3 };
    expect(shouldSendReminder(maxed, TODAY, NOW)).toBe(false);
  });

  it("shouldSendReminder: too soon after last reminder → false", () => {
    const recent = { ...OVERDUE_INVOICE, lastReminderAt: NOW - 1000, reminderCount: 1 };
    expect(shouldSendReminder(recent, TODAY, NOW)).toBe(false);
  });

  it("markReminderSent: increments count", () => {
    const updated = markReminderSent(OVERDUE_INVOICE, NOW);
    expect(updated.reminderCount).toBe(1);
    expect(updated.lastReminderAt).toBe(NOW);
  });
});
