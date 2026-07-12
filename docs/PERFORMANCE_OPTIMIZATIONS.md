# Performance Optimization Guide: Image Lazy Loading & Caching

This document outlines the optimization strategies implemented across the architecture to minimize asset latency, handle external media requests efficiently, and protect database pools during scaling.

---

## 1. Photo Caching Pipeline

To avoid hitting Pexels API rate limits on every workspace search query, the application routes all asset requests through a Redis/Prisma caching middleware layer. 

### Data Flow Lifecycle Sequence

```text
[Client UI] ------------(1) Request Venue Photo-------------> [Next.js API Route]
                                                                     |
                                                           (2) Check Local Cache
                                                                     |
                                                                     v
                                                            /-----------------\
                                                           /   Does Asset Exist \
                                                           \    in Cache Memory? /
                                                            \-----------------/
                                                               /             \
                                                    YES (Valid)               NO (Or Expired)
                                                            /                   \
                                                           v                     v
[Client UI] <---(3a) Return Cached Data---- [Read Cache Store]         [Query Pexels API]
                                                                                 |
                                                                       (3b) Fetch Fresh URL
                                                                                 |
                                                                                 v
[Client UI] <---(5) Render Layout View <--- [Write to Cache] <---(4) Commit Image URL to Store
                                            (Set TTL: 24 Hours)