import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { OrgStore, SessionStore } from '@bo/store';
import {
  Avatar,
  Card,
  CellDef,
  DataTable,
  DateTimePipe,
  Icon,
  TableColumn,
} from '@bo/components';
import { PotentialCustomer } from '../../domain/potential-customer';
import { PotentialCustomerRepository } from '../../data-access/potential-customer.repository';
import { SALES_TEAM } from '../../data-access/fixtures/potential-customers.fixtures';
import { CustomerStatusBadge } from '../../ui/customer-status.badge';

const COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Khách hàng' },
  { key: 'businessLine', label: 'Business line', width: '170px' },
  { key: 'departmentId', label: 'Phòng ban', width: '140px', secondary: true },
  { key: 'assigneeId', label: 'Chủ sở hữu', width: '160px' },
  { key: 'status', label: 'Trạng thái', width: '160px' },
  { key: 'createdAt', label: 'Ngày tạo', width: '160px' },
];

/**
 * SUPERADMIN widget — the newest potential customers across every department
 * the viewer can reach. Proof that a business capability contributes to the
 * organization dashboard, not only to its own department workspace.
 */
@Component({
  selector: 'thg-organization-customers-widget',
  imports: [Avatar, Card, CellDef, CustomerStatusBadge, DataTable, DateTimePipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card
      title="Khách hàng tiềm năng mới"
      [subtitle]="subtitle()"
      actionLabel="Xem tất cả"
      [actionLink]="salesLink()"
      [flush]="true"
    >
      <bo-data-table
        [columns]="columns"
        [rows]="customers.value() ?? []"
        empty="Chưa có khách hàng tiềm năng nào."
        emptyIcon="users"
      >
        <ng-template boCell="name" let-customer>
          <div class="who">
            <strong>{{ customer.name }}</strong>
            <span class="u-subtle">{{ customer.contact }}</span>
          </div>
        </ng-template>

        <ng-template boCell="departmentId" let-customer>
          <span class="u-muted">{{ departmentName(customer.departmentId) }}</span>
        </ng-template>

        <ng-template boCell="assigneeId" let-customer>
          @if (ownerName(customer.assigneeId); as name) {
            <span class="u-row">
              <bo-avatar [name]="name" [size]="22" />
              {{ name }}
            </span>
          } @else {
            <span class="u-subtle u-row">
              <bo-icon name="user-plus" [size]="14" />
              Chưa giao
            </span>
          }
        </ng-template>

        <ng-template boCell="status" let-customer>
          <thg-customer-status [status]="customer.status" />
        </ng-template>

        <ng-template boCell="createdAt" let-customer>
          <span class="u-muted">{{ customer.createdAt | boDateTime }}</span>
        </ng-template>
      </bo-data-table>
    </bo-card>
  `,
  styles: `
    :host {
      display: block;
    }

    .who {
      display: flex;
      flex-direction: column;

      strong {
        font-weight: 500;
      }

      span {
        font-size: var(--t-sm);
      }
    }
  `,
})
export class OrganizationCustomersWidget {
  private readonly repository = inject(PotentialCustomerRepository);
  private readonly session = inject(SessionStore);
  private readonly org = inject(OrgStore);

  protected readonly columns = COLUMNS;

  protected readonly customers = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.list(params, { limit: 6 }),
  });

  protected readonly subtitle = computed(
    () => `${this.customers.value()?.length ?? 0} khách mới nhất trong toàn tổ chức`,
  );

  /** Links into whichever department actually owns this capability. */
  protected readonly salesLink = computed(() => {
    const slug = this.org.byId(this.customers.value()?.[0]?.departmentId)?.slug;
    return slug ? `/departments/${slug}/potential-customers` : null;
  });

  protected departmentName(id: string): string {
    return this.org.byId(id)?.name ?? '—';
  }

  protected ownerName(userId: string | null): string | null {
    return userId ? (SALES_TEAM.find((m) => m.userId === userId)?.name ?? userId) : null;
  }
}
