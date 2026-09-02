-- 0015_trip_execution_event.sql — PROJECT-OWNED (Hoàng Long dispatch).
--
-- What actually happened, and when.
--
-- 0011 records what was PLANNED — `pickup_at`, `delivery_at`, typed by
-- Operations before the lorry moved. Nothing anywhere records what the lorry
-- actually did. Every management question in the contract — was it on time, how
-- late, which step is slow, which trip is stuck — is a comparison between those
-- two axes, and one of the two has never existed.
--
-- ★ FOUR EVENT TYPES, AND THEY ARE NOT A TRIP STATUS.
--
--   ARRIVED_PICKUP · PICKUP_CONFIRMED · ARRIVED_DELIVERY · DELIVERY_CONFIRMED
--
-- `trip_schedules.status` stays exactly as 0011 left it: five DISPATCH values,
-- owned by Operations. The fifteen OPERATIONAL states the business wants to see
-- are DERIVED by reading these events — they are deliberately not persisted as a
-- sixth, seventh, eighth status. A status enum that has to be kept in step with
-- an event log is two sources of truth, and the log is the one that is true.
--
-- ★ THREE TIMESTAMPS, BECAUSE THEY ARE THREE DIFFERENT CLAIMS.
--
--   actual_at           when the thing happened, as recorded
--   recorded_at         when the SERVER heard about it — operational truth
--   device_reported_at  what the handset said its own clock read — DIAGNOSTIC ONLY
--
-- A driver's phone can be wrong, off, or deliberately set. Its clock is never
-- allowed to be the figure a KPI is computed from; it is kept so that a
-- disagreement can be investigated rather than argued about.
--
-- ★ AND A SNAPSHOT OF THE SCHEDULE. `scheduled_at` copies the trip's planned
-- time AT THE MOMENT THE EVENT IS WRITTEN. Without it, Operations correcting a
-- schedule next week silently rewrites whether last week's trip was late — the
-- history would change every time the plan did.

CREATE TABLE IF NOT EXISTS trip_execution_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id              UUID        NOT NULL REFERENCES trip_schedules(id),

  -- ★ WHICH ASSIGNMENT PRODUCED THIS, NOT MERELY WHICH PERSON.
  --
  -- The composite foreign key below pairs this with `trip_id`, so an event can
  -- never carry an assignment belonging to a different trip. Recording the
  -- assignment rather than the user is what keeps the answer stable: if the
  -- driver is replaced tomorrow, this event still says who was driving today.
  driver_assignment_id UUID        NOT NULL,

  event_type           TEXT        NOT NULL
                                   CHECK (event_type IN ('ARRIVED_PICKUP',
                                                         'PICKUP_CONFIRMED',
                                                         'ARRIVED_DELIVERY',
                                                         'DELIVERY_CONFIRMED')),

  -- Snapshots, copied at write time. NEVER joined back to `trip_schedules` on
  -- read: the trip's current vehicle is what it is TODAY, and this event is
  -- about what was true then. `vehicle_ownership` is nullable because 0013
  -- leaves every existing lorry unclassified and nothing may read that as
  -- `company`.
  vehicle_id           UUID        REFERENCES trip_vehicles(id),
  vehicle_ownership    TEXT        CHECK (vehicle_ownership IS NULL
                                          OR vehicle_ownership IN ('company', 'outsourced')),
  scheduled_at         TIMESTAMPTZ,

  actual_at            TIMESTAMPTZ NOT NULL,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_reported_at   TIMESTAMPTZ,

  -- ★ IDEMPOTENCY, SCOPED TO THE TRIP.
  --
  -- A driver on a bad connection taps once and the request is retried three
  -- times. Without this the arrival is recorded three times and every duration
  -- computed from it is wrong. The client generates the id; the unique index
  -- below makes the second and third attempts fail loudly rather than duplicate.
  client_event_id      TEXT        NOT NULL CHECK (length(trim(client_event_id)) > 0),

  recorded_by          UUID        NOT NULL REFERENCES users(id),

  -- Withdrawn, never deleted — the trio 0012 established, with the same rule
  -- that all three move together and a withdrawal always says why.
  voided_at            TIMESTAMPTZ,
  voided_by            UUID        REFERENCES users(id),
  void_reason          TEXT,

  CONSTRAINT trip_execution_events_assignment_matches_trip
    FOREIGN KEY (driver_assignment_id, trip_id)
    REFERENCES trip_driver_assignments (id, trip_id),

  CONSTRAINT trip_execution_events_void_state
    CHECK (
      (voided_at IS NULL     AND voided_by IS NULL     AND void_reason IS NULL)
      OR
      (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
    ),

  CONSTRAINT trip_execution_events_void_reason_not_blank
    CHECK (void_reason IS NULL OR length(trim(void_reason)) > 0)
);

-- Scoped to the trip rather than global: the id only has to be unique among the
-- events of one trip for a retry to collide with its own first attempt, and a
-- global scope would make two unrelated clients able to block each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_trip_execution_event_client
  ON trip_execution_events (trip_id, client_event_id);

-- The timeline read: every event of one trip, in the order they happened.
CREATE INDEX IF NOT EXISTS idx_trip_execution_event_trip
  ON trip_execution_events (trip_id, actual_at);

-- Serves the foreign-key check when an assignment row is ended.
CREATE INDEX IF NOT EXISTS idx_trip_execution_event_assignment
  ON trip_execution_events (driver_assignment_id);
