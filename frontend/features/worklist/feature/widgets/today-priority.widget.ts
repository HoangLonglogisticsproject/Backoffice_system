import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bo/store';
import { Button, Card, Icon } from '@bo/components';
import { WorkItemRepository } from '../../data-access/work-item.repository';
import { WorkItemTable } from '../../ui/work-item-table';

/**
 * MEMBER widget — "Việc ưu tiên hôm nay". The first thing a person on the
 * ground needs, which is why it exists only on their desk.
 */
@Component({
  selector: 'bo-today-priority-widget',
  imports: [Button, Card, Icon, RouterLink, WorkItemTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card title="Việc ưu tiên hôm nay" subtitle="Sắp theo mức ưu tiên và hạn chót" [flush]="true">
      <bo-work-item-table
        [items]="items.value() ?? []"
        empty="Bạn không còn việc nào đến hạn hôm nay."
      />
      <div cardFooter class="footer">
        <a bo-button size="sm" routerLink="/my-work">
          Xem tất cả việc của tôi
          <bo-icon name="arrow-right" [size]="14" />
        </a>
      </div>
    </bo-card>
  `,
  styles: `
    :host {
      display: block;
    }
    .footer {
      padding: var(--s-3) var(--s-4);
      border-top: 1px solid var(--line);
    }
  `,
})
export class TodayPriorityWidget {
  private readonly repository = inject(WorkItemRepository);
  private readonly session = inject(SessionStore);

  protected readonly items = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.list(params, { dueToday: true }),
  });
}
