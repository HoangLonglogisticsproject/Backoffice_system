import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Badge, CellDef, DataTable, DateTimePipe, Icon, TableColumn } from '@bo/components';
import { WorkItem } from '../domain/work-item';
import { PRIORITY_LABEL, STATUS_LABEL, isOverdue } from './work-item-status';

const COLUMNS: TableColumn[] = [
  { key: 'title', label: 'Công việc' },
  { key: 'context', label: 'Liên quan', width: '200px', secondary: true },
  { key: 'priority', label: 'Ưu tiên', width: '120px' },
  { key: 'status', label: 'Trạng thái', width: '140px' },
  { key: 'dueAt', label: 'Hạn', width: '170px' },
];

/** Shared table for every work-item surface, whatever the capability. */
@Component({
  selector: 'bo-work-item-table',
  imports: [Badge, CellDef, DataTable, DateTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-data-table [columns]="columns" [rows]="items()" [empty]="empty()" emptyIcon="check-circle">
      <ng-template boCell="priority" let-item>
        <bo-badge [tone]="priority(item).tone">{{ priority(item).label }}</bo-badge>
      </ng-template>

      <ng-template boCell="status" let-item>
        <bo-badge [tone]="status(item).tone" [dot]="true">{{ status(item).label }}</bo-badge>
      </ng-template>

      <ng-template boCell="dueAt" let-item>
        @if (item.dueAt) {
          <span class="due" [class.due--late]="overdue(item)">
            @if (overdue(item)) {
              <bo-icon name="alert-triangle" [size]="13" />
            }
            {{ item.dueAt | boDateTime }}
          </span>
        } @else {
          <span class="u-subtle">—</span>
        }
      </ng-template>

      <ng-template boCell="context" let-item>
        <span class="u-muted">{{ item.context || '—' }}</span>
      </ng-template>
    </bo-data-table>
  `,
  styles: `
    .due {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .due--late {
      color: var(--c-rose);
      font-weight: 500;
    }
  `,
})
export class WorkItemTable {
  readonly items = input.required<readonly WorkItem[]>();
  readonly empty = input('Không có công việc nào trong phạm vi của bạn.');

  protected readonly columns = COLUMNS;

  protected status(item: WorkItem) {
    return STATUS_LABEL[item.status];
  }

  protected priority(item: WorkItem) {
    return PRIORITY_LABEL[item.priority];
  }

  protected overdue(item: WorkItem) {
    return isOverdue(item);
  }
}
