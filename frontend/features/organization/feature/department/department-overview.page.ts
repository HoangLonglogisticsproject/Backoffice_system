import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { AccessService, CapabilityRegistry } from '@bo/services';
import { Card, EmptyState, Icon } from '@bo/components';
import { accentVars } from '@bo/utils';
import { OverviewRepository } from '../../data-access/overview.repository';
import { MetricRow } from '../../ui/metric-row';

/**
 * The `overview` capability, shown inside any department workspace. Reusable
 * across every department because it is driven by that department's record
 * and its enabled capabilities.
 */
@Component({
  selector: 'bo-department-overview',
  imports: [Card, EmptyState, Icon, MetricRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (department(); as dept) {
      <bo-metric-row [metrics]="metrics.value() ?? []" />

      <bo-card title="Năng lực đang được cấp" subtitle="Cấu hình bởi quản lý tổ chức">
        <div class="capabilities">
          @for (capability of capabilities(); track capability.key) {
            <div class="capability" [style]="vars(capability.accent)">
              <span class="tile"><bo-icon [name]="capability.icon" [size]="16" /></span>
              <div>
                <p class="name">{{ presentationTitle(capability.key) }}</p>
                <p class="key">{{ capability.key }}</p>
              </div>
            </div>
          } @empty {
            <bo-empty-state icon="package" message="Phòng ban này chưa được cấp năng lực nào." />
          }
        </div>
      </bo-card>
    }
  `,
  styleUrl: './department-overview.page.scss',
})
export class DepartmentOverviewPage {
  private readonly repository = inject(OverviewRepository);
  private readonly session = inject(SessionStore);
  private readonly access = inject(AccessService);
  private readonly registry = inject(CapabilityRegistry);

  protected readonly department = inject(WorkspaceContext).department;

  protected readonly capabilities = computed(() => this.access.capabilitiesFor(this.department()));

  protected readonly metrics = rxResource({
    params: () => ({ user: this.session.require(), id: this.department()?.id }),
    stream: ({ params }) => this.repository.departmentMetrics(params.user, params.id ?? ''),
  });

  protected presentationTitle(key: string): string {
    return this.access.presentationFor(key)?.title ?? this.registry.byKey(key)?.title ?? key;
  }

  protected vars(accent: string) {
    return accentVars(accent);
  }
}
