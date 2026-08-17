import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import {
  Button,
  Card,
  CellDef,
  DataTable,
  DateTimePipe,
  Icon,
  ProgressBar,
  TableColumn,
} from '@bo/components';
import { PotentialCustomer, PotentialCustomerStatus } from '../../domain/potential-customer';
import { PotentialCustomerRepository } from '../../data-access/potential-customer.repository';
import { CustomerStatusBadge } from '../../ui/customer-status.badge';
import { ONBOARDING, ONBOARDING_STEPS, SOURCE, isFollowUpDue, isStale } from '../../ui/customer-vocabulary';

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Khách hàng' },
  { key: 'businessLine', label: 'Business line', width: '160px', secondary: true },
  { key: 'source', label: 'Nguồn', width: '150px', secondary: true },
  { key: 'onboarding', label: 'Onboarding', width: '190px' },
  { key: 'status', label: 'Trạng thái', width: '150px' },
  { key: 'followUpAt', label: 'Follow-up', width: '170px' },
];

const FILTERS: Array<{ value: PotentialCustomerStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'ASSIGNED', label: 'Đang phụ trách' },
  { value: 'CONVERTED', label: 'Đã chuyển đổi' },
  { value: 'CLOSED', label: 'Đã đóng' },
];

/**
 * MEMBER surface for the `potential-customers` capability.
 *
 * Same repository as the head's pool page, but this one only ever receives the
 * rows this person owns — the ownership rule is applied in data-access, not by
 * hiding rows here. There is no assign control because assignment is not this
 * persona's job.
 */
@Component({
  selector: 'thg-my-customers',
  imports: [Button, Card, CellDef, CustomerStatusBadge, DataTable, DateTimePipe, Icon, ProgressBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card title="Khách hàng của tôi" [subtitle]="subtitle()" [flush]="true">
      <div cardActions class="filters">
        <label class="search">
          <bo-icon name="search" [size]="13" />
          <input
            type="search"
            placeholder="Tìm khách hàng"
            aria-label="Tìm khách hàng"
            (input)="onSearch($event)"
          />
        </label>
        <div class="chips" role="group" aria-label="Lọc theo trạng thái">
          @for (filter of filters; track filter.value) {
            <button
              bo-button size="sm"
              type="button"
              [attr.aria-pressed]="status() === filter.value"
              [class.btn--primary]="status() === filter.value"
              (click)="status.set(filter.value)"
            >
              {{ filter.label }}
            </button>
          }
        </div>
      </div>

      <bo-data-table
        [columns]="columns"
        [rows]="customers.value() ?? []"
        empty="Bạn chưa được giao khách hàng nào."
        emptyIcon="users"
      >
        <ng-template boCell="name" let-customer>
          <div class="who">
            <strong>{{ customer.name }}</strong>
            <span class="u-subtle">{{ customer.contact }}</span>
          </div>
        </ng-template>

        <ng-template boCell="source" let-customer>
          <span class="u-row u-muted">
            <bo-icon [name]="source(customer).icon" [size]="13" />
            {{ source(customer).label }}
          </span>
        </ng-template>

        <ng-template boCell="onboarding" let-customer>
          <div class="onboarding">
            <span class="u-muted">{{ onboarding(customer).label }}</span>
            <bo-progress-bar
              [value]="onboarding(customer).step"
              [max]="steps"
              accent="teal"
              [label]="'Onboarding: ' + onboarding(customer).label"
            />
          </div>
        </ng-template>

        <ng-template boCell="status" let-customer>
          <thg-customer-status [status]="customer.status" />
        </ng-template>

        <ng-template boCell="followUpAt" let-customer>
          @if (customer.followUpAt) {
            <span class="follow" [class.follow--due]="due(customer)">
              @if (due(customer)) {
                <bo-icon name="clock" [size]="13" />
              }
              {{ customer.followUpAt | boDateTime }}
            </span>
          } @else if (stale(customer)) {
            <span class="follow follow--stale">
              <bo-icon name="alert-triangle" [size]="13" />
              Chưa liên hệ lâu
            </span>
          } @else {
            <span class="u-subtle">—</span>
          }
        </ng-template>
      </bo-data-table>
    </bo-card>
  `,
  styleUrl: './my-customers.page.scss',
})
export class MyCustomersPage {
  private readonly repository = inject(PotentialCustomerRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  protected readonly columns = COLUMNS;
  protected readonly filters = FILTERS;
  protected readonly steps = ONBOARDING_STEPS;

  protected readonly status = signal<PotentialCustomerStatus | 'ALL'>('ALL');
  protected readonly search = signal('');

  protected readonly customers = rxResource({
    params: () => ({
      user: this.session.require(),
      departmentId: this.context.department()?.id ?? '',
      status: this.status(),
      search: this.search(),
    }),
    stream: ({ params }) =>
      this.repository.list(params.user, {
        departmentId: params.departmentId,
        status: params.status === 'ALL' ? undefined : params.status,
        search: params.search || undefined,
      }),
  });

  protected readonly subtitle = computed(() => {
    const all = this.customers.value() ?? [];
    const dueSoon = all.filter(isFollowUpDue).length;
    return `${all.length} khách · ${dueSoon} cần follow-up`;
  });

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value.trim());
  }

  protected source(customer: PotentialCustomer) {
    return SOURCE[customer.source];
  }

  protected onboarding(customer: PotentialCustomer) {
    return ONBOARDING[customer.onboarding];
  }

  protected due(customer: PotentialCustomer) {
    return isFollowUpDue(customer);
  }

  protected stale(customer: PotentialCustomer) {
    return isStale(customer);
  }
}
