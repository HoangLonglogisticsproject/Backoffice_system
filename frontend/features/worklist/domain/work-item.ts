import { OwnedRecord } from '@bo/types';

export type WorkItemStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
export type WorkItemPriority = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * A unit of internal work. Extends OwnedRecord so the platform's ownership
 * rules apply without this module reimplementing them.
 */
export interface WorkItem extends OwnedRecord {
  title: string;
  /** Which capability the item belongs to — 'tasks', 'documents', 'reports'… */
  capability: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  dueAt: string | null;
  updatedAt: string;
  /** Free-form context line, e.g. a customer name or a source system. */
  context?: string;
}
