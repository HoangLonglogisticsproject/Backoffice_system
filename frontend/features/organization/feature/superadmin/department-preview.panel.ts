import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bo/store';
import { AccessService } from '@bo/services';
import { Card, EmptyState, Icon, IconButton, Radial, Select, Skeleton } from '@bo/components';
import { Metric } from '../../domain/overview';
import { OverviewRepository } from '../../data-access/overview.repository';

/**
 * A peek into one department's workspace without leaving the organization view.
 * Which department is a runtime choice, so a company with twenty of them gets a
 * picker rather than twenty hand-written panels.
 */
@Component({
  selector: 'bo-department-preview',
  imports: [Card, EmptyState, Icon, IconButton, Radial, RouterLink, Select, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selected(); as dept) {
      <bo-card [title]="dept.name + ' workspace'" subtitle="Chỉ số nhanh của phòng ban">
        <div cardActions class="tools">
          <select boSelect aria-label="Chọn phòng ban để xem trước" (change)="choose($event)">
            @for (option of departments(); track option.id) {
              <option [value]="option.slug" [selected]="option.slug === dept.slug">
                {{ option.name }}
              </option>
            }
          </select>
          <a
            bo-icon-button size="sm"
            [routerLink]="['/departments', dept.slug]"
            [attr.aria-label]="'Mở workspace ' + dept.name"
            [title]="'Mở workspace ' + dept.name"
          >
            <bo-icon name="external-link" [size]="14" />
          </a>
        </div>

        @if (metrics.isLoading()) {
          <bo-skeleton height="74px" />
        } @else if (counts().length) {
          <div class="figures">
            <dl class="counts">
              @for (metric of counts(); track metric.key) {
                <div class="count">
                  <dt [title]="metric.label">{{ metric.short ?? metric.label }}</dt>
                  <dd>{{ metric.value }}</dd>
                </div>
              }
            </dl>

            @if (ratio(); as rate) {
              <div class="rate">
                <bo-radial [value]="rate.ratio ?? 0" [label]="rate.value" [accent]="rate.accent" />
                <p>{{ rate.label }}</p>
              </div>
            }
          </div>
        } @else {
          <bo-empty-state icon="bar-chart" message="Phòng ban này chưa có chỉ số nào." />
        }

        <div cardFooter class="footer">
          <a class="link" [routerLink]="['/departments', dept.slug]">
            Xem tất cả trong {{ dept.name }}
            <bo-icon name="arrow-right" [size]="13" />
          </a>
        </div>
      </bo-card>
    }
  `,
  styleUrl: './department-preview.panel.scss',
})
export class DepartmentPreviewPanel {
  private readonly repository = inject(OverviewRepository);
  private readonly session = inject(SessionStore);
  private readonly access = inject(AccessService);

  protected readonly departments = this.access.visibleDepartments;

  private readonly chosen = signal<string | null>(null);

  protected readonly selected = computed(() => {
    const all = this.departments();
    return all.find((d) => d.slug === this.chosen()) ?? all[0];
  });

  protected readonly metrics = rxResource({
    params: () => ({ user: this.session.require(), id: this.selected()?.id }),
    stream: ({ params }) => this.repository.departmentMetrics(params.user, params.id ?? ''),
  });

  /** Plain counts read as a row; the one ratio reads as a ring. */
  protected readonly counts = computed<Metric[]>(() =>
    (this.metrics.value() ?? []).filter((m) => m.ratio === undefined).slice(0, 4),
  );

  protected readonly ratio = computed<Metric | undefined>(() =>
    (this.metrics.value() ?? []).find((m) => m.ratio !== undefined),
  );

  protected choose(event: Event): void {
    this.chosen.set((event.target as HTMLSelectElement).value);
  }
}
