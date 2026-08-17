import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Badge, BadgeTone, EmptyState, Icon, RelativeTimePipe } from '@bo/components';
import { accentVars } from '@bo/utils';
import { ApprovalItem, ApprovalPriority } from '../domain/overview';

const PRIORITY: Record<ApprovalPriority, { label: string; tone: BadgeTone }> = {
  high: { label: 'Cao', tone: 'danger' },
  medium: { label: 'Trung bình', tone: 'warning' },
  low: { label: 'Thấp', tone: 'info' },
};

@Component({
  selector: 'bo-approval-list',
  imports: [Badge, EmptyState, Icon, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of items(); track item.id) {
      <article class="row" [style]="vars(item.accent)">
        <span class="tile"><bo-icon [name]="item.icon" [size]="15" /></span>
        <div class="body">
          <p class="title">{{ item.title }}</p>
          <p class="context">{{ item.context }}</p>
        </div>
        <bo-badge [tone]="priority(item).tone">{{ priority(item).label }}</bo-badge>
        <time>{{ item.createdAt | boRelativeTime }}</time>
      </article>
    } @empty {
      <bo-empty-state icon="check-circle" message="Không có yêu cầu nào đang chờ bạn." />
    }
  `,
  styleUrl: './approval-list.scss',
})
export class ApprovalList {
  readonly items = input.required<readonly ApprovalItem[]>();

  protected priority(item: ApprovalItem) {
    return PRIORITY[item.priority];
  }

  protected vars(accent: string) {
    return accentVars(accent);
  }
}
