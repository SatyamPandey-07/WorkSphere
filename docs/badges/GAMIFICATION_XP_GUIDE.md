# Gamification & Experience Points (XP) Verification Guide

## Overview

WorkSphere gamifies digital nomad contributions to encourage crowdsourced data collection (verified speed tests, noise reports, venue reviews, and new venue additions). Nomads earn Experience Points (XP) and unlock verified achievement badges displayed on their profile and community nomad passport.

---

## Experience Points (XP) Earning Formulas

XP is calculated deterministically based on authenticated, verified platform contributions:

| Activity | XP Awarded | Verification Criteria |
| :--- | :--- | :--- |
| **Venue Review** | **+50 XP** | Submitted by authenticated user with valid rating and review text ($\ge 10$ characters). |
| **Venue Created** | **+100 XP** | New venue listing created with complete address coordinates and approved by moderation. |
| **Verified Speedtest** | **+100 XP** | Completed telemetry sample with positive download and upload speeds, verified within geographic bounds. |

### Aggregate Total XP Formula
$$\text{Total XP} = (\text{Reviews} \times 50) + (\text{Venues Created} \times 100) + (\text{Verified Speedtests} \times 100)$$

---

## Badge Eligibility Criteria

### 1. Night Owl (`night_owl`)
Awarded to digital nomads and night-shift remote workers contributing during late-night and early-morning hours.

- **Criteria**: At least one venue review submitted between **21:00 (9:00 PM)** and **04:00 (4:00 AM)** in the user's localized IANA timezone (`user.timezone`).
- **Timezone Normalization**:
  - The review's UTC creation timestamp (`createdAt`) is converted to the user's configured IANA timezone (falling back to UTC if unconfigured).
  - Evaluated using:
    $$\text{localHour} \ge 21 \quad \lor \quad \text{localHour} < 4$$
  - Ensures accurate qualification regardless of where the API server or database is hosted.

### 2. WiFi Scout (`wifi_scout`)
Awarded to nomads actively mapping and validating venue internet reliability.

- **Criteria**: **3 or more** verified crowdsourced WiFi speed tests.
- **Upload Speed Validation**: Each qualifying speed test record must have:
  $$\text{uploadSpeed} > 0 \quad \text{and} \quad \text{downloadSpeed} > 0$$
- **Progress Tracking**: Tracks progress from 0 to 3 speed tests ($0/3, 1/3, 2/3, 3/3$). Once 3 qualifying tests are reached, the badge is unlocked.

---

## Anti-Abuse & Rate Limiting

To prevent automated XP grinding or duplicate telemetry submissions:
1. **Speedtest Throttling**: A maximum of 1 speed test per venue per user per 4-hour window awards XP.
2. **Review Geofencing**: Reviews receive a `verifiedVisit` multiplier only when GPS proximity is verified within 100 meters of venue coordinates during check-in.
3. **Database Transactions**: XP increments and badge allocations execute within atomic Prisma transactions (`prisma.$transaction`) to prevent race conditions.
