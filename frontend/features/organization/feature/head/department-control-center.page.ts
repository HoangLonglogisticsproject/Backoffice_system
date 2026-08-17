import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { AccessService } from '@bo/services';
import { WidgetHost } from '@bo/services';
import { Badge, Button, Card, EmptyState, Icon, PageHeader } from '@bo/components';
import { OverviewRepository } from '../../data-access/overview.repository';
import { ApprovalList } from '../../ui/approval-list';
import { MetricRow } from '../../ui/metric-row';
import { SuggestionList } from '../../ui/suggestion-list';

/**
 * DEPARTMENT_HEAD — the department control centre.
 * Question it answers: "Phòng của tôi đang vận hành như thế nào?"
 *
 * No department cards, no cross-department anything. The substance of this
 * page — the customer pool, team workload, assignment — arrives as widgets
 * from whatever capabilities the department has, which is why this file
 * contains no Sales vocabulary at all.
 */
@Component({
  selector: 'bo-department-control-center',
  imports: [ApprovalList, Badge, Button, Card, EmptyState, Icon, MetricRow, PageHeader, SuggestionList, WidgetHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (department(); as dept) {
      <bo-page-header
        [title]="dept.name"
        [subtitle]="'Điều hành phòng ' + dept.name + ' · ' + dept.memberCount + ' thành viên'"
      >
        <div pageActions>
          <bo-badge tone="success" [dot]="true">Đang hoạt động</bo-badge>
          <button bo-button size="sm" type="button">
            <bo-icon name="plus" [size]="14" />
            Đề xuất năng lực
          </button>
        </div>
      </bo-page-header>

      <bo-metric-row [metrics]="metrics.value() ?? []" />

      <bo-widget-host role="DEPARTMENT_HEAD" [capabilities]="dept.capabilities" />

      <div class="panels">
        <bo-card title="Yêu cầu nội bộ của phòng" [flush]="true">
          <bo-approval-list [items]="approvals.value() ?? []" />
        </bo-card>

        <bo-card title="AI hỗ trợ điều phối" badge="Beta" [flush]="true">
          <bo-suggestion-list [items]="suggestions.value() ?? []" />
        </bo-card>
      </div>
    } @else {
      <bo-empty-state
        icon="building"
        message="Tài khoản trưởng phòng chưa được gắn với phòng ban nào. Liên hệ quản trị viên."
      />
    }
  `,
  styleUrl: './department-control-center.page.scss',
})
export class DepartmentControlCenterPage {
  private readonly repository = inject(OverviewRepository);
  private readonly session = inject(SessionStore);
  private readonly access = inject(AccessService);
  private readonly context = inject(WorkspaceContext);

  protected readonly department = this.access.ownDepartment;

  constructor() {
    // Widgets read the department from the workspace context, not from a route.
    effect(() => this.context.set(this.department()));
  }

  private readonly params = computed(() => ({
    user: this.session.require(),
    departmentId: this.department()?.id,
  }));

  protected readonly metrics = rxResource({
    params: () => this.params(),
    stream: ({ params }) =>
      this.repository.departmentMetrics(params.user, params.departmentId ?? ''),
  });

  protected readonly approvals = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.approvals(params),
  });

  protected readonly suggestions = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.suggestions(params),
  });
}
