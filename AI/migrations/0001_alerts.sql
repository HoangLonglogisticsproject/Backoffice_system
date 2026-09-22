-- 0001_alerts.sql — the Alert aggregate, its transition history, and the scan
-- run ledger. ADR-0007, Phase 1a.
--
-- ★ UNQUALIFIED NAMES, ON PURPOSE. The runner sets `search_path` to the AI
-- schema (`ai` in every real deployment) before this file runs, so every
-- object below lands in that schema. Writing `ai.alerts` here would pin the
-- file to one schema name and break the integration suite, which applies this
-- same file into a throwaway schema per spec.
--
-- ★ NO FOREIGN KEY LEAVES THIS SCHEMA. `trip_id`, `subject_id`, `actor_id` and
-- every `*_by` are UUID snapshots of identifiers the backend owns. A FK into
-- `public.*` would make the backend unable to evolve its tables without the
-- AI's consent, and would require this role to hold REFERENCES on tables it
-- is otherwise denied — the exact coupling the boundary exists to prevent.
-- Display names for actors are joined by the BACKEND at read time (ADR-0001).
--
-- ★ NO DENY-DELETE TRIGGER, AND THAT IS A DELIBERATE DEVIATION from the
-- backend's history tables. Retention (12 months for alerts, 30 days for scan
-- runs — CEO, 2026-09-19) is a real, authorised DELETE by a dedicated
-- `ai_maintenance` role. A trigger would forbid that too. "No runtime DELETE"
-- is enforced instead by GRANT (ai_app has no DELETE) and by the boundary
-- check on source.

-- ------------------------------------------------------------- updated_at --
-- Schema-local, unqualified, so it lands in the AI schema and does not depend
-- on `public` holding the backend's (0002).
--
-- ★ MONOTONIC, UNLIKE THE BACKEND'S. `now()` is the TRANSACTION start time.
-- Two workers upsert the same alert; the one that BEGAN earlier commits
-- later, and with `now()` its `updated_at` would land BEFORE the value the
-- other worker already persisted — a timestamp that moves backwards. Found
-- by the concurrent-upsert test on `last_seen_at`; this closes the same hole
-- for `updated_at`. `clock_timestamp()` is the wall clock at execution, and
-- GREATEST guarantees the column never decreases even if two clocks disagree.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = GREATEST(OLD.updated_at, clock_timestamp());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------ alerts --
--
-- One row per INCIDENT: a detector saw a condition on a subject. The same
-- condition seen again while the incident is open, acknowledged or DISMISSED
-- updates this row (see the partial unique index); after the incident is
-- resolved, the condition returning is a new incident and a new row.
CREATE TABLE IF NOT EXISTS alerts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which rule produced it, and which revision of that rule. The version
  -- moves when the LOGIC changes, never when a threshold is reconfigured —
  -- the configuration in force is snapshotted into `evidence` instead.
  detector_code       TEXT        NOT NULL CHECK (length(trim(detector_code)) > 0),
  detector_version    INTEGER     NOT NULL CHECK (detector_version >= 1),

  -- Phase 1 writes only 'rule'. The other two are admitted NOW so Phase 2/3
  -- do not need a migration just to be allowed to exist.
  source_type         TEXT        NOT NULL CHECK (source_type IN ('rule', 'anomaly', 'ai')),

  subject_type        TEXT        NOT NULL
                                  CHECK (subject_type IN ('trip', 'assignment', 'completion_request')),
  subject_id          UUID        NOT NULL,
  -- Denormalised for filtering and for the UI; every Phase 1 subject belongs
  -- to a trip. Nullable because a future subject may not.
  trip_id             UUID,

  -- The full scale is admitted; Phase 1 detectors emit warning and high only.
  severity            TEXT        NOT NULL CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  status              TEXT        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'acknowledged', 'dismissed', 'resolved')),

  title               TEXT        NOT NULL CHECK (length(trim(title)) > 0),
  summary             TEXT        NOT NULL,

  -- Structured, explainable facts. `evidence_version` names the SHAPE, so a
  -- reader knows which keys to expect without inspecting the JSON.
  evidence            JSONB       NOT NULL,
  evidence_version    INTEGER     NOT NULL CHECK (evidence_version >= 1),

  dedupe_key          TEXT        NOT NULL CHECK (length(trim(dedupe_key)) > 0),

  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The number of DISTINCT SCAN RUNS that observed this incident — not the
  -- number of times a signal arrived. A run that retries or sees the subject
  -- twice adds nothing; the upsert decides against `last_scan_run_id` in SQL.
  occurrence_count    INTEGER     NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),

  acknowledged_at     TIMESTAMPTZ,
  acknowledged_by     UUID,

  dismissed_at        TIMESTAMPTZ,
  dismissed_by        UUID,
  dismissed_reason    TEXT,

  resolved_at         TIMESTAMPTZ,
  -- NULL when the system resolved it. There is no fake system user.
  resolved_by         UUID,
  resolution_kind     TEXT        CHECK (resolution_kind IS NULL OR resolution_kind IN ('system_cleared', 'user')),

  -- Scan runs are referenced by id only: they are pruned on a 30-day cycle
  -- while alerts live 12 months, and a FK would make the first impossible.
  first_scan_run_id   UUID,
  last_scan_run_id    UUID,
  resolved_scan_run_id UUID,

  -- NULL for rule detectors. Confidence is not severity (principle 13).
  confidence          NUMERIC(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Paired columns move together, as everywhere in the backend schema.
  CONSTRAINT alerts_ack_pair
    CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CONSTRAINT alerts_dismiss_trio
    CHECK (
      (dismissed_at IS NULL AND dismissed_by IS NULL AND dismissed_reason IS NULL)
      OR
      (dismissed_at IS NOT NULL AND dismissed_by IS NOT NULL
        AND dismissed_reason IS NOT NULL AND length(trim(dismissed_reason)) > 0)
    ),
  CONSTRAINT alerts_resolution_pair
    CHECK ((resolved_at IS NULL) = (resolution_kind IS NULL)),
  -- A user resolution names the user; a system resolution names nobody.
  CONSTRAINT alerts_resolution_actor
    CHECK (
      resolution_kind IS NULL
      OR (resolution_kind = 'user' AND resolved_by IS NOT NULL)
      OR (resolution_kind = 'system_cleared' AND resolved_by IS NULL)
    ),
  -- The status column and the timestamp columns tell one story.
  CONSTRAINT alerts_status_evidence
    CHECK (
      (status = 'resolved') = (resolved_at IS NOT NULL)
      AND (status <> 'acknowledged' OR acknowledged_at IS NOT NULL)
      AND (status <> 'dismissed'    OR dismissed_at IS NOT NULL)
    ),
  CONSTRAINT alerts_seen_order
    CHECK (last_seen_at >= first_seen_at)
);

-- ★ THE DEDUPE RULE, ENFORCED BY POSTGRESQL. At most one LIVE incident per
-- dedupe key, where "live" includes DISMISSED: a dismissed incident suppresses
-- the condition until the system verifies it has cleared, so Discovery seeing
-- the same key again must land on the dismissed row, not open a second one.
-- Once RESOLVED the row leaves this predicate and the key is free again.
-- Two workers upserting the same key at once cannot both insert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_live_dedupe
  ON alerts (dedupe_key)
  WHERE status IN ('open', 'acknowledged', 'dismissed');

-- The list: status tabs, newest activity first, keyset on (last_seen_at, id).
CREATE INDEX IF NOT EXISTS idx_alert_list
  ON alerts (status, last_seen_at DESC, id DESC);

-- Everything about one trip, for the trip page and for Resolution by subject.
CREATE INDEX IF NOT EXISTS idx_alert_trip
  ON alerts (trip_id)
  WHERE trip_id IS NOT NULL;

-- Resolution enumerates "every live alert of detector X".
CREATE INDEX IF NOT EXISTS idx_alert_detector_live
  ON alerts (detector_code, status)
  WHERE status IN ('open', 'acknowledged', 'dismissed');

DROP TRIGGER IF EXISTS alerts_set_updated_at ON alerts;
CREATE TRIGGER alerts_set_updated_at
  BEFORE UPDATE ON alerts
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------- alert_transition_history --
--
-- Every status change, appended in the SAME transaction as the change (the
-- repository takes an executor with no default, like the backend's
-- trip_status_history). Insert-only for the runtime by GRANT.
CREATE TABLE IF NOT EXISTS alert_transition_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id        UUID        NOT NULL REFERENCES alerts(id),

  -- NULL on the row that records the alert's creation.
  from_status     TEXT        CHECK (from_status IS NULL
                                     OR from_status IN ('open', 'acknowledged', 'dismissed', 'resolved')),
  to_status       TEXT        NOT NULL
                              CHECK (to_status IN ('open', 'acknowledged', 'dismissed', 'resolved')),

  -- 'user' names a person by id; 'system' names nobody. The pairing CHECK is
  -- what makes a NULL actor_id unambiguous — the backend's role_assignments
  -- provenance columns are the precedent.
  actor_type      TEXT        NOT NULL CHECK (actor_type IN ('user', 'system')),
  actor_id        UUID,

  reason          TEXT,
  scan_run_id     UUID,
  correlation_id  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT alert_history_actually_changed
    CHECK (from_status IS NULL OR from_status <> to_status),
  CONSTRAINT alert_history_actor_pair
    CHECK ((actor_type = 'system') = (actor_id IS NULL)),
  CONSTRAINT alert_history_dismiss_reason
    CHECK (to_status <> 'dismissed' OR length(trim(coalesce(reason, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS idx_alert_history_alert
  ON alert_transition_history (alert_id, created_at DESC);

-- --------------------------------------------------------------- scan_runs --
--
-- FOUNDATION ONLY in Phase 1a: the table the Phase 1b engine will write one
-- row per (detector, phase) run into. Its purpose is the failure-semantics
-- invariant — a run that did not reach `succeeded` never resolves anything —
-- and it doubles as the metrics store (counters are columns, not logs).
CREATE TABLE IF NOT EXISTS scan_runs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  detector_code     TEXT        NOT NULL CHECK (length(trim(detector_code)) > 0),
  detector_version  INTEGER     NOT NULL CHECK (detector_version >= 1),

  -- Discovery and Resolution are different operations (ADR-0007 §M).
  phase             TEXT        NOT NULL CHECK (phase IN ('discovery', 'resolution')),

  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  outcome           TEXT        NOT NULL DEFAULT 'running'
                                CHECK (outcome IN ('running', 'succeeded', 'partial', 'failed', 'abandoned')),

  candidates        INTEGER     NOT NULL DEFAULT 0 CHECK (candidates >= 0),
  signals           INTEGER     NOT NULL DEFAULT 0 CHECK (signals >= 0),
  created           INTEGER     NOT NULL DEFAULT 0 CHECK (created >= 0),
  updated           INTEGER     NOT NULL DEFAULT 0 CHECK (updated >= 0),
  resolved          INTEGER     NOT NULL DEFAULT 0 CHECK (resolved >= 0),

  -- The thresholds and bands in force for this run, so an alert can say
  -- "with these settings" without the settings having to be a table.
  config_snapshot   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error             TEXT,
  correlation_id    TEXT,

  CONSTRAINT scan_runs_finished
    CHECK ((outcome = 'running') = (finished_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_scan_run_detector
  ON scan_runs (detector_code, started_at DESC);
