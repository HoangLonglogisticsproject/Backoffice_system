import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { Button, Card, EmptyState, Icon } from '@bo/components';
import { PotentialCustomerRepository } from '../../data-access/potential-customer.repository';
import { SOURCE } from '../../ui/customer-vocabulary';
import { PotentialCustomer } from '../../domain/potential-customer';

/**
 * DEPARTMENT_HEAD widget — the unassigned queue, front and centre on their
 * dashboard. Assigning happens on the full page; this is the alarm bell.
 */
@Component({
  selector: 'thg-customer-pool-widget',
  imports: [Button, Card, EmptyState, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card title="Khách hàng chưa phân công" [subtitle]="subtitle()" [flush]="true">
      @for (customer of top(); track customer.id) {
        <div class="row">
          <div class="who">
            <strong>{{ customer.name }}</strong>
            <span class="u-subtle">
              {{ customer.businessLine }} · {{ source(customer).label }}
            </span>
          </div>
          <a bo-button size="sm" [routerLink]="poolLink()">Phân công</a>
        </div>
      } @empty {
        <bo-empty-state icon="check-circle" message="Mọi khách hàng đều đã có người phụ trách." />
      }

      @if ((pool.value()?.length ?? 0) > top().length) {
        <div cardFooter class="footer">
          <a bo-button size="sm" [routerLink]="poolLink()">
            Xem tất cả {{ pool.value()?.length }} khách
            <bo-icon name="arrow-right" [size]="14" />
          </a>
        </div>
      }
    </bo-card>
  `,
  styleUrl: './customer-pool.widget.scss',
})
export class CustomerPoolWidget {
  private readonly repository = inject(PotentialCustomerRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  protected readonly pool = rxResource({
    params: () => ({
      user: this.session.require(),
      departmentId: this.context.department()?.id ?? '',
    }),
    stream: ({ params }) => this.repository.pool(params.user, params.departmentId),
  });

  /** A dashboard shows the queue's shape; the page shows the queue. */
  protected readonly top = computed(() => (this.pool.value() ?? []).slice(0, 4));

  protected readonly subtitle = computed(
    () => `${this.pool.value()?.length ?? 0} khách đang chờ điều phối`,
  );

  protected readonly poolLink = computed(
    () => `/departments/${this.context.department()?.slug ?? ''}/potential-customers`,
  );

  protected source(customer: PotentialCustomer) {
    return SOURCE[customer.source];
  }
}
