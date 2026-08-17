import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { Button, Card, EmptyState, Icon, StatCard } from '@bo/components';
import { PotentialCustomerRepository } from '../../data-access/potential-customer.repository';
import { ONBOARDING } from '../../ui/customer-vocabulary';
import { isFollowUpDue, isStale } from '../../ui/customer-vocabulary';

/**
 * MEMBER widget — the personal book at a glance, plus what is due. The numbers
 * are about this one person, which is why the head never sees this panel.
 */
@Component({
  selector: 'thg-my-customers-widget',
  imports: [Button, Card, EmptyState, Icon, RouterLink, StatCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stats">
      <bo-stat-card
        label="Khách đang phụ trách"
        [value]="String(active().length)"
        hint="Đang trong quá trình chăm sóc"
        icon="users"
        accent="blue"
      />
      <bo-stat-card
        label="Follow-up đến hạn"
        [value]="String(dueSoon().length)"
        hint="Trong 24 giờ tới"
        icon="clock"
        accent="amber"
      />
      <bo-stat-card
        label="Đang onboarding"
        [value]="String(onboarding().length)"
        hint="Chưa hoàn tất các bước"
        icon="package"
        accent="teal"
      />
    </div>

    <bo-card title="Khách cần liên hệ" subtitle="Đến hạn hoặc đã lâu chưa trao đổi" [flush]="true">
      @for (customer of attention(); track customer.id) {
        <div class="row">
          <div class="who">
            <strong>{{ customer.name }}</strong>
            <span class="u-subtle">
              {{ customer.contact }} · {{ stage(customer.onboarding) }}
            </span>
          </div>
          <span class="flag" [class.flag--stale]="stale(customer)">
            {{ stale(customer) ? 'Chưa liên hệ lâu' : 'Đến hạn follow-up' }}
          </span>
        </div>
      } @empty {
        <bo-empty-state icon="check-circle" message="Bạn đang theo sát tất cả khách hàng." />
      }

      <div cardFooter class="footer">
        <a bo-button size="sm" [routerLink]="listLink()">
          Xem tất cả khách hàng của tôi
          <bo-icon name="arrow-right" [size]="14" />
        </a>
      </div>
    </bo-card>
  `,
  styleUrl: './my-customers.widget.scss',
})
export class MyCustomersWidget {
  private readonly repository = inject(PotentialCustomerRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  protected readonly String = String;

  private readonly customers = rxResource({
    params: () => ({
      user: this.session.require(),
      departmentId: this.context.department()?.id ?? '',
    }),
    stream: ({ params }) => this.repository.list(params.user, { departmentId: params.departmentId }),
  });

  private readonly all = computed(() => this.customers.value() ?? []);

  protected readonly active = computed(() => this.all().filter((c) => c.status === 'ASSIGNED'));
  protected readonly dueSoon = computed(() => this.all().filter(isFollowUpDue));
  protected readonly onboarding = computed(() =>
    this.active().filter((c) => c.onboarding !== 'ONBOARDED'),
  );

  /** Due now, or quietly going cold — both need a call today. */
  protected readonly attention = computed(() =>
    this.all().filter((c) => isFollowUpDue(c) || isStale(c)),
  );

  protected readonly listLink = computed(
    () => `/departments/${this.context.department()?.slug ?? ''}/potential-customers`,
  );

  protected stage(key: keyof typeof ONBOARDING): string {
    return ONBOARDING[key].label;
  }

  protected stale(customer: { lastContactedAt: string | null; status: string }) {
    return isStale(customer);
  }
}
