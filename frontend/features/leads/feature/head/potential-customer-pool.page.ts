import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { SessionStore, WorkspaceContext } from '@bo/store';
import {
  Avatar,
  Button,
  Card,
  CellDef,
  DataTable,
  DateTimePipe,
  Icon,
  Input,
  TableColumn,
} from '@bo/components';
import { PotentialCustomer } from '../../domain/potential-customer';
import { PotentialCustomerRepository } from '../../data-access/potential-customer.repository';
import { SALES_TEAM } from '../../data-access/fixtures/potential-customers.fixtures';
import { CustomerStatusBadge } from '../../ui/customer-status.badge';
import { SOURCE } from '../../ui/customer-vocabulary';

const POOL_COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Khách hàng' },
  { key: 'businessLine', label: 'Business line', width: '170px', secondary: true },
  { key: 'source', label: 'Nguồn', width: '160px', secondary: true },
  { key: 'createdAt', label: 'Ngày vào', width: '160px', secondary: true },
  { key: 'assign', label: 'Phân công', width: '210px', align: 'right' },
];

const ALL_COLUMNS: TableColumn[] = [
  { key: 'name', label: 'Khách hàng' },
  { key: 'businessLine', label: 'Business line', width: '170px', secondary: true },
  { key: 'assigneeId', label: 'Phụ trách', width: '160px' },
  { key: 'status', label: 'Trạng thái', width: '160px' },
  { key: 'lastContactedAt', label: 'Liên hệ gần nhất', width: '170px', secondary: true },
];

/**
 * DEPARTMENT_HEAD surface for the `potential-customers` capability.
 *
 * A head runs distribution: an unassigned pool with an Assign action, and the
 * whole department's book. The member page (same capability, same repository)
 * is a different component entirely — see feature/member.
 */
@Component({
  selector: 'thg-potential-customer-pool',
  imports: [Avatar, Button, Card, CellDef, CustomerStatusBadge, DataTable, DateTimePipe, Icon, Input],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-card
      title="Khách hàng chưa phân công"
      [subtitle]="poolSubtitle()"
      [flush]="true"
    >
      <bo-data-table
        [columns]="poolColumns"
        [rows]="pool.value() ?? []"
        empty="Không còn khách hàng nào chờ phân công."
        emptyIcon="check-circle"
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

        <ng-template boCell="createdAt" let-customer>
          <span class="u-muted">{{ customer.createdAt | boDateTime }}</span>
        </ng-template>

        <ng-template boCell="assign" let-customer>
          <div class="assign">
            <select
              boInput
              [attr.aria-label]="'Phân công ' + customer.name"
              [value]="picked()[customer.id] ?? ''"
              (change)="pick(customer.id, $event)"
            >
              <option value="" disabled>Chọn nhân viên</option>
              @for (member of team; track member.userId) {
                <option [value]="member.userId">{{ member.name }}</option>
              }
            </select>
            <button
              bo-button size="sm" variant="primary"
              type="button"
              [disabled]="!picked()[customer.id] || busy() === customer.id"
              (click)="assign(customer)"
            >
              {{ busy() === customer.id ? 'Đang giao…' : 'Giao' }}
            </button>
          </div>
        </ng-template>
      </bo-data-table>

      @if (error(); as message) {
        <p class="error">{{ message }}</p>
      }
    </bo-card>

    <bo-card title="Toàn bộ khách hàng của phòng" [flush]="true">
      <bo-data-table
        [columns]="allColumns"
        [rows]="all.value() ?? []"
        empty="Phòng chưa có khách hàng tiềm năng nào."
      >
        <ng-template boCell="name" let-customer>
          <div class="who">
            <strong>{{ customer.name }}</strong>
            <span class="u-subtle">{{ customer.contact }}</span>
          </div>
        </ng-template>

        <ng-template boCell="assigneeId" let-customer>
          @if (memberName(customer.assigneeId); as name) {
            <span class="u-row">
              <bo-avatar [name]="name" [size]="22" />
              {{ name }}
            </span>
          } @else {
            <span class="u-subtle">Chưa giao</span>
          }
        </ng-template>

        <ng-template boCell="status" let-customer>
          <thg-customer-status [status]="customer.status" />
        </ng-template>

        <ng-template boCell="lastContactedAt" let-customer>
          <span class="u-muted">{{ customer.lastContactedAt | boDateTime }}</span>
        </ng-template>
      </bo-data-table>
    </bo-card>
  `,
  styleUrl: './potential-customer-pool.page.scss',
})
export class PotentialCustomerPoolPage {
  private readonly repository = inject(PotentialCustomerRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  protected readonly poolColumns = POOL_COLUMNS;
  protected readonly allColumns = ALL_COLUMNS;
  // ponytail: team comes from the fixture module; switch to
  // DepartmentRepository.members() once the API exposes it.
  protected readonly team = SALES_TEAM;

  protected readonly picked = signal<Record<string, string | undefined>>({});
  protected readonly busy = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  private readonly params = computed(() => ({
    user: this.session.require(),
    departmentId: this.context.department()?.id ?? '',
  }));

  protected readonly pool = rxResource({
    params: () => this.params(),
    stream: ({ params }) => this.repository.pool(params.user, params.departmentId),
  });

  protected readonly all = rxResource({
    params: () => this.params(),
    stream: ({ params }) => this.repository.list(params.user, { departmentId: params.departmentId }),
  });

  protected readonly poolSubtitle = computed(
    () => `${this.pool.value()?.length ?? 0} khách đang chờ được giao cho nhân viên`,
  );

  protected pick(customerId: string, event: Event): void {
    const assigneeId = (event.target as HTMLSelectElement).value;
    this.picked.update((state) => ({ ...state, [customerId]: assigneeId }));
  }

  protected async assign(customer: PotentialCustomer): Promise<void> {
    const assigneeId = this.picked()[customer.id];
    if (!assigneeId) return;

    this.busy.set(customer.id);
    this.error.set(null);
    try {
      await firstValueFrom(this.repository.assign(this.session.require(), customer.id, assigneeId));
      this.pool.reload();
      this.all.reload();
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'Không phân công được khách hàng.');
    } finally {
      this.busy.set(null);
    }
  }

  protected memberName(userId: string | null): string | null {
    return userId ? (this.team.find((m) => m.userId === userId)?.name ?? userId) : null;
  }

  protected source(customer: PotentialCustomer) {
    return SOURCE[customer.source];
  }
}
