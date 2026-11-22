# WorkSphere Real-Time Decibel Meter & Acoustic Monitoring Specification

This document defines the decibel boundary thresholds, acoustic color tagging, and occupational health standards used by WorkSphere's real-time noise meter.

## 1. Decibel Boundary Thresholds & UI Color Coding

| Noise Level Category | Decibel Range | Acoustic Color Tag | UI Indicator / Badge | Environmental Description |
| :--- | :--- | :--- | :--- | :--- |
| **Quiet** | `< 45 dB` | Emerald Green | `bg-emerald-500/20 text-emerald-400` | Optimal for deep focus, reading, and virtual meetings. |
| **Moderate** | `45 - 65 dB` | Amber Yellow | `bg-amber-500/20 text-amber-400` | Acceptable background chatter and collaborative coworking. |
| **Loud** | `> 65 dB` | Rose Red | `bg-rose-500/20 text-rose-400` | Distracting environmental noise. Requires relocation or noise cancellation. |

## 2. NIOSH and WHO Recommended Limits for Knowledge Work

- **WHO Community Noise Guidelines:** Indoor residential and study spaces should remain below **45 dB** to prevent concentration disruption.
- **NIOSH Occupational Limits:** Recommends an 8-hour time-weighted average (TWA) limit of **85 dBA**. Sustained noise above **65 dB** triggers workspace focus warnings.