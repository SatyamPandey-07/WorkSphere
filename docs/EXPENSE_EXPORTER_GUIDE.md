# Neural Ledger Batch Expense Exporter Guide

This guide describes how to use the automated batch expense report exporter feature in the WorkSphere Neural Ledger interface.

---

## Overview

Remote workers often need to submit workspace expenses to their finance departments or clients. The WorkSphere expense exporter allows users to filter, select, and batch export their booking history details (including confirmation IDs, venues, dates, times, billing codes, taxes, and totals) in two popular formats:
1. **CSV (Spreadsheet)**: For import into Excel or Google Sheets.
2. **PDF Report**: For visual verification and receipts submission.

---

## How to Export

1. Open the **Neural Ledger** from the dashboard.
2. Select a **Date Range Filter** (e.g., *Current Month*, *Q1*, or *All Bookings*) to narrow down your history list.
3. Check individual bookings, or check the **Select All** checkbox.
4. Click either **Export CSV** or **Export PDF** at the bottom of the ledger.
5. The report will download automatically with the filename structure `WorkSphere_Expenses.<format>`.

---

## Calculations Policy
All totals in the expense report are computed using the platform standard:
- **Base Rate**: $15.00/hour
- **Flat tax**: 8%
- **Billing Code**: Retrieved from your project billing code during booking.
