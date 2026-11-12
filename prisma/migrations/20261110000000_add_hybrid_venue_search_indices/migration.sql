-- Enable Extensions for Trigram and Double Metaphone
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- GIN Index for Trigram Similarity on Venue Name
CREATE INDEX IF NOT EXISTS "idx_venue_name_trgm" 
ON "Venue" USING gin ("name" gin_trgm_ops);

-- GIN Index for Full-Text Search on Name and Description
CREATE INDEX IF NOT EXISTS "idx_venue_fts" 
ON "Venue" USING gin (to_tsvector('english', COALESCE("name", '') || ' ' || COALESCE("description", '')));