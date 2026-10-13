ALTER TABLE "Venue"
  ADD COLUMN "searchVector" tsvector,
  ADD COLUMN "searchEmbedding" vector(1024);

CREATE FUNCTION update_venue_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', concat_ws(' ',
      NEW.category,
      array_to_string(NEW."foodTags", ' '),
      array_to_string(NEW."powerTypes", ' '),
      NEW."noiseLevel",
      NEW."lighting",
      NEW."musicStyle",
      CASE WHEN NEW."wifiQuality" IS NOT NULL THEN 'wifi wireless internet' END,
      CASE WHEN NEW."wifiSpeed" IS NOT NULL THEN NEW."wifiSpeed"::text || ' mbps fast wifi' END,
      CASE WHEN NEW."hasOutlets" THEN 'power outlets charging' END,
      CASE WHEN NEW."hasErgonomic" THEN 'ergonomic seating chair' END,
      CASE WHEN NEW."hasPhoneBooths" THEN 'phone booth private calls' END,
      CASE WHEN NEW."hasQuietZone" OR NEW."noiseLevel" = 'quiet' THEN 'quiet focus concentration' END,
      CASE WHEN NEW."hasNoMusic" THEN 'no music silent' END,
      CASE WHEN NEW."dogFriendly" OR NEW."petsAllowedIndoors" THEN 'dog pet friendly' END,
      CASE WHEN NEW."hasAncHeadsetRental" THEN 'noise cancelling headset' END
    )), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.address, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

UPDATE "Venue" SET "searchVector" =
  setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
  setweight(to_tsvector('english', concat_ws(' ',
    "category",
    array_to_string("foodTags", ' '),
    array_to_string("powerTypes", ' '),
    "noiseLevel",
    "lighting",
    "musicStyle",
    CASE WHEN "wifiQuality" IS NOT NULL THEN 'wifi wireless internet' END,
    CASE WHEN "wifiSpeed" IS NOT NULL THEN "wifiSpeed"::text || ' mbps fast wifi' END,
    CASE WHEN "hasOutlets" THEN 'power outlets charging' END,
    CASE WHEN "hasErgonomic" THEN 'ergonomic seating chair' END,
    CASE WHEN "hasPhoneBooths" THEN 'phone booth private calls' END,
    CASE WHEN "hasQuietZone" OR "noiseLevel" = 'quiet' THEN 'quiet focus concentration' END,
    CASE WHEN "hasNoMusic" THEN 'no music silent' END,
    CASE WHEN "dogFriendly" OR "petsAllowedIndoors" THEN 'dog pet friendly' END,
    CASE WHEN "hasAncHeadsetRental" THEN 'noise cancelling headset' END
  )), 'B') ||
  setweight(to_tsvector('english', coalesce("address", '')), 'C');

CREATE TRIGGER venue_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "name", "category", "address", "foodTags", "powerTypes", "noiseLevel", "lighting", "musicStyle", "wifiQuality", "wifiSpeed", "hasOutlets", "hasErgonomic", "hasPhoneBooths", "hasQuietZone", "hasNoMusic", "dogFriendly", "petsAllowedIndoors", "hasAncHeadsetRental"
  ON "Venue"
  FOR EACH ROW EXECUTE FUNCTION update_venue_search_vector();

CREATE INDEX "Venue_searchVector_gin_idx"
  ON "Venue" USING GIN ("searchVector");

CREATE INDEX "Venue_searchEmbedding_hnsw_idx"
  ON "Venue" USING hnsw ("searchEmbedding" vector_cosine_ops);
