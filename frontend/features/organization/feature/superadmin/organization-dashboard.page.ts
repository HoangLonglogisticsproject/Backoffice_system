import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bo/store';
import { AccessService, BRANDING } from '@bo/services';
import { WidgetHost } from '@bo/services';
import { Button, Card, Icon, PageHeader, SectionHeader, Skeleton } from '@bo/components';
import { OverviewRepository } from '../../data-access/overview.repository';
import { ActivityFeed } from '../../ui/activity-feed';
import { ApprovalList } from '../../ui/approval-list';
import { DepartmentCard } from '../../ui/department-card';
import { MetricRow } from '../../ui/metric-row';
import { SuggestionList } from '../../ui/suggestion-list';
import { DepartmentPreviewPanel } from './department-preview.panel';

/**
 * SUPERADMIN — the company control centre.
 * Question it answers: "Công ty đang vận hành như thế nào?"
 *
 * Everything is cross-department: org metrics, every department as a card, one
 * department previewed in place, the approval queue from all of them, and
 * org-wide activity. Capability widgets registered for this persona are
 * appended by the widget host.
 */
@Component({
  selector: 'bo-organization-dashboard',
  imports: [
    ActivityFeed,
    ApprovalList,
    Button,
    Card,
    DepartmentCard,
    DepartmentPreviewPanel,
    Icon,
    MetricRow,
    PageHeader,
    RouterLink,
    SectionHeader,
    Skeleton,
    SuggestionList,
    WidgetHost,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-page-header [title]="branding.productName" subtitle="Nền tảng vận hành nội bộ thống nhất">
      <div pageActions>
        <button bo-button size="sm" type="button">
          <bo-icon name="settings" [size]="14" />
          Tùy chỉnh dashboard
        </button>
        <button bo-button size="sm" type="button">
          <bo-icon name="calendar" [size]="14" />
          7 ngày qua
          <bo-icon name="chevron-down" [size]="13" />
        </button>
      </div>
    </bo-page-header>

    @if (metrics.isLoading()) {
      <bo-skeleton height="88px" />
    } @else {
      <bo-metric-row [metrics]="metrics.value() ?? []" />
    }

    <section>
      <bo-section-header title="Phòng ban" actionLabel="Xem tất cả" actionLink="/departments" />
      <div class="departments">
        @for (department of departments(); track department.id) {
          <bo-department-card [department]="department" />
        }
      </div>
    </section>

    <div class="panels">
      <bo-department-preview />

      <bo-card
        title="Phê duyệt / Yêu cầu chờ xử lý"
        actionLabel="Xem tất cả"
        actionLink="/approvals"
        [flush]="true"
      >
        <bo-approval-list [items]="approvals.value() ?? []" />
        <div cardFooter class="footer">
          <a bo-button size="sm" variant="soft" block routerLink="/requests">
            Xem tất cả yêu cầu
            <bo-icon name="arrow-right" [size]="14" />
          </a>
        </div>
      </bo-card>

      <bo-card title="AI Điều phối" badge="Beta" [flush]="true">
        <bo-suggestion-list [items]="suggestions.value() ?? []" />
        <div cardFooter class="footer">
          <a bo-button size="sm" variant="soft" block routerLink="/ai">
            Xem tất cả gợi ý
            <bo-icon name="arrow-right" [size]="14" />
          </a>
        </div>
      </bo-card>
    </div>

    <!-- Capability widgets registered for this persona. -->
    <bo-widget-host role="SUPERADMIN" [capabilities]="allCapabilities()" />

    <bo-card title="Hoạt động gần đây" actionLabel="Xem tất cả hoạt động" actionLink="/activity">
      <bo-activity-feed [items]="activity.value() ?? []" />
    </bo-card>
  `,
  styleUrl: './organization-dashboard.page.scss',
})
export class OrganizationDashboardPage {
  private readonly repository = inject(OverviewRepository);
  private readonly session = inject(SessionStore);
  private readonly access = inject(AccessService);

  protected readonly branding = inject(BRANDING);
  protected readonly departments = this.access.visibleDepartments;

  /** Union across the organization — a widget shows if any department has it. */
  protected readonly allCapabilities = computed(() => [
    ...new Set(this.departments().flatMap((d) => d.capabilities)),
  ]);

  protected readonly metrics = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.organizationMetrics(params),
  });

  protected readonly approvals = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.approvals(params),
  });

  protected readonly suggestions = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.suggestions(params),
  });

  protected readonly activity = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.activity(params),
  });
}
