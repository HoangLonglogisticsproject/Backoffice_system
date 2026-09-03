-- 0022_trip_locations.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- Where a customer's goods are picked up and delivered, as rows.
--
-- A customer tells Sales or dispatch where their warehouses are — by email,
-- booking, contract, a phone call. Until now that arrived on the board as
-- prose typed into every trip, and since 0019 as a pair of coordinates typed
-- beside it. A dispatcher does not know coordinates and should not have to:
-- the place is the customer's master data, entered once and chosen after.
--
-- ★ OWNED BY ONE CUSTOMER. `customer_id` is NOT NULL and a location is only
-- ever listed, chosen or edited under its customer. There is no global pool: a
-- trip for customer A can only name A's places, and the service refuses any
-- other pairing whatever the client sent.
--
-- ★ COORDINATES ARE OPTIONAL HERE, AND THE TRIP SNAPSHOTS THEM. A place is
-- real before anybody has located it, so it can be created and used with no
-- coordinates — the trip's own columns (0019) then stay NULL and the driver's
-- confirmation is refused as DESTINATION_MISSING exactly as today. When the
-- trip is created it COPIES address, contact and coordinates onto its own row;
-- editing this table later changes the next trip, never a past one. Nothing
-- in the execution path reads this table.
--
-- Same shape and rules as `trip_customers`: DOUBLE PRECISION and the 0019
-- coordinate CHECK, a generated `name_key`, unique among ACTIVE rows per
-- customer, archived never deleted.

CREATE TABLE IF NOT EXISTS trip_locations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID        NOT NULL REFERENCES trip_customers(id),

  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  -- The same normalisation as `trip_customers.name_key`, for the same reason:
  -- `Kho OSC` and `kho  osc` are one place; the index below says so.
  name_key    TEXT        GENERATED ALWAYS AS
                          (upper(trim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,

  address     TEXT        NOT NULL CHECK (length(trim(address)) > 0),
  contact     TEXT,
  note        TEXT,

  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,

  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'archived')),

  created_by  UUID        NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Both halves or neither, on Earth. The 0019 rule, on the master row.
  CONSTRAINT trip_locations_coordinates
    CHECK (
      (latitude IS NULL) = (longitude IS NULL)
      AND (latitude  IS NULL OR latitude  BETWEEN -90  AND 90)
      AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
    )
);

-- One name per customer among the places still in use. An archived name may
-- be reused — a warehouse can close and reopen under the same name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_location_name
  ON trip_locations (customer_id, name_key)
  WHERE status = 'active';

-- The one read: a customer's places.
CREATE INDEX IF NOT EXISTS idx_trip_location_customer
  ON trip_locations (customer_id, status, name);

DROP TRIGGER IF EXISTS trip_locations_set_updated_at ON trip_locations;
CREATE TRIGGER trip_locations_set_updated_at
  BEFORE UPDATE ON trip_locations
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- A place a trip once went to is history. Archive it; never delete it.
DROP TRIGGER IF EXISTS trip_locations_deny_delete ON trip_locations;
CREATE TRIGGER trip_locations_deny_delete
  BEFORE DELETE ON trip_locations
  FOR EACH ROW EXECUTE FUNCTION deny_delete();

-- ------------------------------------------- trip_schedules: provenance ----
--
-- Which master row the snapshot was copied from. NULLABLE and unset on every
-- existing trip: those were typed by hand, their snapshot stands, and nothing
-- is backfilled or guessed. The snapshot columns from 0011 and 0019 are what
-- every reader — the board, the driver, the geofence — keeps reading.

ALTER TABLE trip_schedules
  ADD COLUMN IF NOT EXISTS pickup_location_id   UUID REFERENCES trip_locations(id),
  ADD COLUMN IF NOT EXISTS delivery_location_id UUID REFERENCES trip_locations(id);

-- Serve the foreign-key checks when a location row is updated.
CREATE INDEX IF NOT EXISTS idx_trip_schedule_pickup_location
  ON trip_schedules (pickup_location_id);

CREATE INDEX IF NOT EXISTS idx_trip_schedule_delivery_location
  ON trip_schedules (delivery_location_id);
