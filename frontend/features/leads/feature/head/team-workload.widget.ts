import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { Avatar, Card, EmptyState, ProgressBar } from '@bo/components';
import { PotentialCustomerRepository } from '../../data-access/potential-customer.repository';

/**
 * DEPARTMENT_HEAD widget — who is carrying how much. Exists so distribution
 * decisions are made against real load rather than guesswork.
 */
@Component({
  selector: 'thg-team-workload-widget',
  imports: [Avatar, Card, EmptyState, ProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card title="Tải công việc của đội" subtitle="Khách đang phụ trách / đã chuyển đổi">
      @for (member of workload.value() ?? []; track member.userId) {
        <div class="row">
          <bo-avatar [name]="member.name" [size]="28" />
          <div class="body">
            <p class="head">
              <span class="name">{{ member.name }}</span>
              <span class="figures">
                <strong>{{ member.active }}</strong> đang phụ trách ·
                {{ member.converted }} chuyển đổi
              </span>
            </p>
            <bo-progress-bar
              [value]="member.active"
              [max]="peak()"
              [accent]="member.active >= peak() ? 'rose' : 'blue'"
              [label]="member.name + ': ' + member.active + ' khách'"
            />
          </div>
        </div>
      } @empty {
        <bo-empty-state icon="users" message="Chưa có dữ liệu tải công việc." />
      }
    </bo-card>
  `,
  styleUrl: './team-workload.widget.scss',
})
export class TeamWorkloadWidget {
  private readonly repository = inject(PotentialCustomerRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  protected readonly workload = rxResource({
    params: () => ({
      user: this.session.require(),
      departmentId: this.context.department()?.id ?? '',
    }),
    stream: ({ params }) => this.repository.workload(params.user, params.departmentId),
  });

  /** Bars are relative to the busiest person, so overload is obvious. */
  protected readonly peak = computed(() =>
    Math.max(1, ...(this.workload.value() ?? []).map((m) => m.active)),
  );
}
