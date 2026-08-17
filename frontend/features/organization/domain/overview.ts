import { AccentKey } from '@bo/types';

/** Aggregates the workspace capability renders. Tenant-neutral shapes. */

export interface Metric {
  key: string;
  label: string;
  /** Compact form for narrow columns; falls back to `label`. */
  short?: string;
  value: string;
  hint?: string;
  icon: string;
  accent: AccentKey;
  delta?: number;
  /** True when a falling number is the good news (overdue work, churn). */
  invertDelta?: boolean;
  trend?: number[];
  /**
   * 0–100 when the metric IS a ratio. Lets a surface draw it as a ring instead
   * of a bare number; metrics that are counts leave it undefined.
   */
  ratio?: number;
}

export type ApprovalPriority = 'low' | 'medium' | 'high';

export interface ApprovalItem {
  id: string;
  title: string;
  departmentId: string;
  context: string;
  priority: ApprovalPriority;
  createdAt: string;
  icon: string;
  accent: AccentKey;
}

export interface ActivityItem {
  id: string;
  departmentId: string;
  actor: string;
  action: string;
  target: string;
  at: string;
}

export interface Suggestion {
  id: string;
  title: string;
  body: string;
  icon: string;
  accent: AccentKey;
}
