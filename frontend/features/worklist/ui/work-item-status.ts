import { BadgeTone } from '@bo/components';
import { WorkItemPriority, WorkItemStatus } from '../domain/work-item';

/**
 * Business status → visual tone. Lives in the capability, not the ui-kit, so
 * the design system never learns a tenant's vocabulary.
 */
export const STATUS_LABEL: Record<WorkItemStatus, { label: string; tone: BadgeTone }> = {
  TODO: { label: 'Cần làm', tone: 'info' },
  IN_PROGRESS: { label: 'Đang xử lý', tone: 'warning' },
  BLOCKED: { label: 'Đang vướng', tone: 'danger' },
  DONE: { label: 'Hoàn thành', tone: 'success' },
};

export const PRIORITY_LABEL: Record<WorkItemPriority, { label: string; tone: BadgeTone }> = {
  HIGH: { label: 'Cao', tone: 'danger' },
  MEDIUM: { label: 'Trung bình', tone: 'warning' },
  LOW: { label: 'Thấp', tone: 'neutral' },
};

export function isOverdue(item: { dueAt: string | null; status: WorkItemStatus }): boolean {
  return item.status !== 'DONE' && item.dueAt !== null && new Date(item.dueAt).getTime() < Date.now();
}
