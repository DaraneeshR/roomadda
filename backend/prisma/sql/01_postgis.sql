-- 01_postgis.sql
-- PostGIS geography support for pg_listings.location.
-- Idempotent: safe to run on every deploy (after `prisma migrate deploy`).

CREATE EXTENSION IF NOT EXISTS postgis;

-- The geography column is managed here (not by Prisma, which does not model the
-- geography type). Added after `prisma migrate deploy` creates pg_listings.
ALTER TABLE pg_listings
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

-- Maintain pg_listings.location (geography) from latitude/longitude so app code
-- only ever writes the two scalar columns; PostGIS owns the geometry.
CREATE OR REPLACE FUNCTION roomadda_sync_listing_location()
RETURNS trigger AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.location := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_listing_location ON pg_listings;
CREATE TRIGGER trg_sync_listing_location
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON pg_listings
  FOR EACH ROW
  EXECUTE FUNCTION roomadda_sync_listing_location();

-- Spatial index for radius / nearest-neighbour search.
CREATE INDEX IF NOT EXISTS idx_pg_listings_location
  ON pg_listings
  USING GIST (location);
