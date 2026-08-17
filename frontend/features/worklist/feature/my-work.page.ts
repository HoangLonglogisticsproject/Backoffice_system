import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore } from '@bo/store';
import { Card, PageHeader } from '@bo/components';
import { WorkItemRepository } from '../data-access/work-item.repository';
import { WorkItemTable } from '../ui/work-item-table';
import { isOverdue } from '../ui/work-item-status';

/**
 * "Việc của tôi" — the same route for every persona, but the repository scopes
 * rows by ownership, so a member sees theirs and a head sees the department's.
 */
@Component({
  selector: 'bo-my-work',
  imports: [Card, PageHeader, WorkItemTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-page-header title="Việc của tôi" [subtitle]="summary()" />

    <bo-card title="Đến hạn hôm nay" [flush]="true">
      <bo-work-item-table [items]="dueToday()" empty="Không có việc nào đến hạn hôm nay." />
    </bo-card>

    <bo-card title="Tất cả công việc" [flush]="true">
      <bo-work-item-table [items]="items.value() ?? []" />
    </bo-card>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--s-5);
      max-width: var(--page-max);
    }
  `,
})
export class MyWorkPage {
  private readonly repository = inject(WorkItemRepository);
  private readonly session = inject(SessionStore);

  protected readonly items = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.list(params, {}),
  });

  protected readonly dueToday = computed(() =>
    (this.items.value() ?? []).filter((item) => item.status !== 'DONE' && item.dueAt !== null &&
      new Date(item.dueAt).getTime() <= Date.now() + 86_400_000),
  );

  protected readonly summary = computed(() => {
    const all = this.items.value() ?? [];
    const overdue = all.filter(isOverdue).length;
    const open = all.filter((item) => item.status !== 'DONE').length;
    return `${open} việc đang mở · ${overdue} việc quá hạn`;
  });
}
