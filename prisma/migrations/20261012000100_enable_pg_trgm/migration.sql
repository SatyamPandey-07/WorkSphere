-- The typo-tolerant venue search fallback (src/lib/search/hybridVenueSearch.ts)
-- calls SIMILARITY(), which is provided by pg_trgm.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
