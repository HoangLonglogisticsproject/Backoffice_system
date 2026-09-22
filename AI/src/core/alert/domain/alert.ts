/**
 * The Alert aggregate — what a detector saw, and what people did about it.
 *
 * Pure types and closed vocabularies. Nothing here imports a framework or a
 * driver (boundary rule A4): every rule about an alert must be checkable in a
 * test with no Nest, no HTTP and no PostgreSQL.
 */

export const ALERT_STATUSES = ['open', 'acknowledged', 'dismissed', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * Statuses under which an incident is LIVE — it still occupies its dedupe key.
 *
 * ★ DISMISSED IS LIVE. Dismissing suppresses the incident until the system
 * verifies the condition has cleared (CEO, Option B). Discovery seeing the
 * same key must update the dismissed row, never open a second one. This list
 * is the predicate of the partial unique index in 0001 — change one, change
 * both.
 */
export const LIVE_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

export const ALERT_SEVERITIES = ['info', 'warning', 'high', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Phase 1 emits only `rule`; the rest are admitted so Phase 2/3 add no migration. */
export const ALERT_SOURCE_TYPES = ['rule', 'anomaly', 'ai'] as const;
export type AlertSourceType = (typeof ALERT_SOURCE_TYPES)[number];

export const ALERT_SUBJECT_TYPES = ['trip', 'assignment', 'completion_request'] as const;
export type AlertSubjectType = (typeof ALERT_SUBJECT_TYPES)[number];

export const RESOLUTION_KINDS = ['system_cleared', 'user'] as const;
export type ResolutionKind = (typeof RESOLUTION_KINDS)[number];

/** JSON that can be stored in the `evidence` column. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Structured evidence. A plain object of JSON values, keyed by the detector;
 * `evidenceVersion` on the alert names the shape a reader should expect.
 */
export type AlertEvidence = { [key: string]: JsonValue };

/** The shape of `evidence` this revision of the domain writes. Bump when keys change. */
export const EVIDENCE_VERSION = 1;

export interface Alert {
  id: string;
  detectorCode: string;
  detectorVersion: number;
  sourceType: AlertSourceType;
  subjectType: AlertSubjectType;
  subjectId: string;
  tripId: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  summary: string;
  evidence: AlertEvidence;
  evidenceVersion: number;
  dedupeKey: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  dismissedAt: Date | null;
  dismissedBy: string | null;
  dismissedReason: string | null;
  resolvedAt: Date | null;
  /** `null` when the system resolved it — there is no fake system user. */
  resolvedBy: string | null;
  resolutionKind: ResolutionKind | null;
  firstScanRunId: string | null;
  lastScanRunId: string | null;
  resolvedScanRunId: string | null;
  /** `null` for rule detectors. Confidence is not severity. */
  confidence: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a detector emits: a positive observation, with no identity yet. The
 * engine turns it into an incident (or refreshes the live one) by dedupe key.
 */
export interface AlertSignal {
  detectorCode: string;
  detectorVersion: number;
  sourceType: AlertSourceType;
  subjectType: AlertSubjectType;
  subjectId: string;
  tripId: string | null;
  severity: AlertSeverity;
  title: string;
  summary: string;
  evidence: AlertEvidence;
  /** Omitted or `null` for rule detectors. */
  confidence?: number | null;
}
