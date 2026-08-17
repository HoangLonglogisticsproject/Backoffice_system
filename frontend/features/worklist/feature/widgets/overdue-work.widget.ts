import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { Card } from '@bo/components';
import { WorkItemRepository } from '../../data-access/work-item.repository';
import { WorkItemTable } from '../../ui/work-item-table';
import { isOverdue } from '../../ui/work-item-status';

/**
 * Supervisory widget — work that has slipped. Registered for the personas who
 * can actually act on it (superadmin, head), never for a member.
 */
@Component({
  selector: 'bo-overdue-work-widget',
  imports: [Card, WorkItemTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card title="Công việc đang quá hạn" [subtitle]="subtitle()" [flush]="true">
      <bo-work-item-table [items]="overdue()" empty="Không có công việc nào quá hạn." />
    </bo-card>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class OverdueWorkWidget {
  private readonly repository = inject(WorkItemRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  private readonly items = rxResource({
    params: () => ({
      user: this.session.require(),
      departmentId: this.context.department()?.id,
    }),
    stream: ({ params }) => this.repository.list(params.user, { departmentId: params.departmentId }),
  });

  protected readonly overdue = computed(() => (this.items.value() ?? []).filter(isOverdue));
  protected readonly subtitle = computed(() => `${this.overdue().length} việc cần xử lý ngay`);
}
