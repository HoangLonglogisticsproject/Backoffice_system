import { Injectable, signal } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import { UserContext } from '@bo/types';
import { canAssignRecords, visibleRecords } from '@bo/services';
import { PotentialCustomer, TeamWorkload } from '../domain/potential-customer';
import { PotentialCustomerQuery, PotentialCustomerRepository } from './potential-customer.repository';
import { POTENTIAL_CUSTOMERS, SALES_TEAM } from './fixtures/potential-customers.fixtures';

const respond = <T>(value: T): Observable<T> => of(value).pipe(delay(140));

/**
 * In-memory implementation. Assignment mutates the store so the demo shows a
 * real state change; every read applies the platform's ownership rule, so what
 * the UI can render already matches what a server would return.
 */
@Injectable()
export class FixturePotentialCustomerRepository extends PotentialCustomerRepository {
  private readonly records = signal<PotentialCustomer[]>(structuredClone(POTENTIAL_CUSTOMERS));

  list(user: UserContext, query: PotentialCustomerQuery): Observable<PotentialCustomer[]> {
    let items = visibleRecords(this.records(), user);

    if (query.departmentId) items = items.filter((c) => c.departmentId === query.departmentId);
    if (query.status) items = items.filter((c) => c.status === query.status);
    if (query.search) {
      const term = query.search.toLowerCase();
      items = items.filter(
        (c) => c.name.toLowerCase().includes(term) || c.contact.toLowerCase().includes(term),
      );
    }
    if (query.limit !== undefined) {
      items = [...items]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit);
    }
    return respond(items);
  }

  pool(user: UserContext, departmentId: string): Observable<PotentialCustomer[]> {
    if (!canAssignRecords(user)) return forbidden();
    return respond(
      visibleRecords(this.records(), user).filter(
        (c) => c.departmentId === departmentId && c.status === 'UNASSIGNED',
      ),
    );
  }

  workload(user: UserContext, departmentId: string): Observable<TeamWorkload[]> {
    if (!canAssignRecords(user)) return forbidden();
    const mine = this.records().filter((c) => c.departmentId === departmentId);
    return respond(
      SALES_TEAM.map(({ userId, name }) => ({
        userId,
        name,
        active: mine.filter((c) => c.assigneeId === userId && c.status === 'ASSIGNED').length,
        converted: mine.filter((c) => c.assigneeId === userId && c.status === 'CONVERTED').length,
      })),
    );
  }

  assign(user: UserContext, customerId: string, assigneeId: string): Observable<PotentialCustomer> {
    if (!canAssignRecords(user)) return forbidden();

    const updated = this.records().find((c) => c.id === customerId);
    if (!updated) return throwError(() => new Error('Không tìm thấy khách hàng'));

    const next: PotentialCustomer = {
      ...updated,
      assigneeId,
      status: 'ASSIGNED',
      lastContactedAt: null,
    };
    this.records.update((list) => list.map((c) => (c.id === customerId ? next : c)));
    return respond(next);
  }
}

/** Mirrors what the API will return; the UI must handle it either way. */
const forbidden = <T>(): Observable<T> =>
  throwError(() => new Error('Bạn không có quyền thực hiện thao tác này'));
