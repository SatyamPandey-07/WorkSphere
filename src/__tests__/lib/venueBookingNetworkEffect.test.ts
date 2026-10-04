/**
 * Tests for venue booking network effect and platform growth metrics.
 */

interface PlatformSnapshot {
  date: string;
  totalVenues: number;
  totalUsers: number;
  totalBookings: number;
  activeVenues: number;  // had booking in last 30d
  activeUsers: number;   // made booking in last 30d
}

function venueToUserRatio(snapshot: PlatformSnapshot): number {
  if (snapshot.totalUsers === 0) return 0;
  return Math.round((snapshot.totalVenues / snapshot.totalUsers) * 100) / 100;
}

function bookingsPerActiveUser(snapshot: PlatformSnapshot): number {
  if (snapshot.activeUsers === 0) return 0;
  return Math.round((snapshot.totalBookings / snapshot.activeUsers) * 100) / 100;
}

function venueUtilisationRate(snapshot: PlatformSnapshot): number {
  if (snapshot.totalVenues === 0) return 0;
  return Math.round((snapshot.activeVenues / snapshot.totalVenues) * 100);
}

function userActivationRate(snapshot: PlatformSnapshot): number {
  if (snapshot.totalUsers === 0) return 0;
  return Math.round((snapshot.activeUsers / snapshot.totalUsers) * 100);
}

function periodGrowth(current: PlatformSnapshot, previous: PlatformSnapshot): {
  venueGrowth: number;
  userGrowth: number;
  bookingGrowth: number;
} {
  const gr = (curr: number, prev: number) =>
    prev === 0 ? 0 : Math.round(((curr - prev) / prev) * 100);
  return {
    venueGrowth:   gr(current.totalVenues,   previous.totalVenues),
    userGrowth:    gr(current.totalUsers,    previous.totalUsers),
    bookingGrowth: gr(current.totalBookings, previous.totalBookings),
  };
}

const CURRENT: PlatformSnapshot = {
  date: "2026-09-30", totalVenues: 500, totalUsers: 10000, totalBookings: 5000,
  activeVenues: 350, activeUsers: 2000,
};
const PREVIOUS: PlatformSnapshot = {
  date: "2026-08-31", totalVenues: 400, totalUsers: 8000, totalBookings: 3500,
  activeVenues: 250, activeUsers: 1500,
};

describe("Platform network effect metrics", () => {
  it("venueToUserRatio: 500/10000 = 0.05", () => {
    expect(venueToUserRatio(CURRENT)).toBe(0.05);
  });

  it("bookingsPerActiveUser: 5000/2000 = 2.5", () => {
    expect(bookingsPerActiveUser(CURRENT)).toBe(2.5);
  });

  it("venueUtilisationRate: 350/500 = 70%", () => {
    expect(venueUtilisationRate(CURRENT)).toBe(70);
  });

  it("userActivationRate: 2000/10000 = 20%", () => {
    expect(userActivationRate(CURRENT)).toBe(20);
  });

  it("periodGrowth: venue +25%, user +25%, booking +43%", () => {
    const growth = periodGrowth(CURRENT, PREVIOUS);
    expect(growth.venueGrowth).toBe(25);
    expect(growth.userGrowth).toBe(25);
    expect(growth.bookingGrowth).toBe(43);
  });
});
