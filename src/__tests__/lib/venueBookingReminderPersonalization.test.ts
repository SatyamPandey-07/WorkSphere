/**
 * Tests for personalized booking reminder message generation.
 */

interface BookingContext {
  bookingId: string;
  userId: string;
  userName: string;
  venueName: string;
  date: string;
  startTime: string;
  seatType: string;
  isFirstVisit: boolean;
  hasParking: boolean;
  weatherForecast?: string;
}

function generateReminderTitle(ctx: BookingContext): string {
  if (ctx.isFirstVisit) return `Welcome to ${ctx.venueName}! Your booking is tomorrow`;
  return `Reminder: Your booking at ${ctx.venueName} tomorrow`;
}

function generateReminderBody(ctx: BookingContext): string {
  const parts = [
    `Hi ${ctx.userName}!`,
    `Your ${ctx.seatType.replace(/_/g, " ")} booking at ${ctx.venueName} is on ${ctx.date} at ${ctx.startTime}.`,
  ];
  if (ctx.isFirstVisit) parts.push("Pro tip: Arrive 5 min early to settle in.");
  if (ctx.hasParking) parts.push("Free parking is available on-site.");
  if (ctx.weatherForecast) parts.push(`Weather: ${ctx.weatherForecast}`);
  return parts.join(" ");
}

function generateActionButtons(ctx: BookingContext): string[] {
  const actions = ["View Booking", "Add to Calendar"];
  if (ctx.isFirstVisit) actions.push("View Venue Guide");
  actions.push("Get Directions");
  return actions;
}

describe("Booking reminder personalization", () => {
  const FIRST_VISIT_CTX: BookingContext = {
    bookingId: "b1", userId: "u1", userName: "Alice",
    venueName: "The Coffee Hub", date: "2026-10-15", startTime: "09:00",
    seatType: "hot_desk", isFirstVisit: true, hasParking: true,
    weatherForecast: "Sunny, 20°C",
  };

  const RETURN_CTX: BookingContext = {
    ...FIRST_VISIT_CTX, isFirstVisit: false, weatherForecast: undefined,
  };

  it("generateReminderTitle: first visit has welcome", () => {
    expect(generateReminderTitle(FIRST_VISIT_CTX)).toContain("Welcome");
  });

  it("generateReminderTitle: return visit has 'Reminder'", () => {
    expect(generateReminderTitle(RETURN_CTX)).toContain("Reminder");
  });

  it("generateReminderBody: includes user name", () => {
    expect(generateReminderBody(FIRST_VISIT_CTX)).toContain("Alice");
  });

  it("generateReminderBody: first visit includes pro tip", () => {
    expect(generateReminderBody(FIRST_VISIT_CTX)).toContain("5 min early");
  });

  it("generateReminderBody: parking info included", () => {
    expect(generateReminderBody(FIRST_VISIT_CTX)).toContain("parking");
  });

  it("generateReminderBody: weather included when provided", () => {
    expect(generateReminderBody(FIRST_VISIT_CTX)).toContain("Sunny");
  });

  it("generateReminderBody: no weather when not provided", () => {
    expect(generateReminderBody(RETURN_CTX)).not.toContain("Weather");
  });

  it("generateActionButtons: first visit has venue guide", () => {
    expect(generateActionButtons(FIRST_VISIT_CTX)).toContain("View Venue Guide");
  });

  it("generateActionButtons: return visit no venue guide", () => {
    expect(generateActionButtons(RETURN_CTX)).not.toContain("View Venue Guide");
  });
});
