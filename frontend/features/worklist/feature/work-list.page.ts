import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { Card } from '@bo/components';
import { WorkItemRepository } from '../data-access/work-item.repository';
import { WorkItemTable } from '../ui/work-item-table';

/**
 * One page serving several capabilities (tasks, documents, reports, content,
 * requests). The capability key comes from route data; the department from the
 * workspace context; the visible rows from the repository's ownership scoping.
 */
@Component({
  selector: 'bo-work-list',
  imports: [Card, WorkItemTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card [title]="title()" [flush]="true">
      <bo-work-item-table [items]="items.value() ?? []" />
    </bo-card>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class WorkListPage {
  private readonly repository = inject(WorkItemRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);
  private readonly data = toSignal(inject(ActivatedRoute).data, {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly title = computed(() => String(this.data()['title'] ?? 'Công việc'));

  protected readonly items = rxResource({
    params: () => ({
      user: this.session.require(),
      departmentId: this.context.department()?.id,
      capability: String(this.data()['capability'] ?? 'tasks'),
    }),
    stream: ({ params }) =>
      this.repository.list(params.user, {
        departmentId: params.departmentId,
        capability: params.capability,
      }),
  });
}
