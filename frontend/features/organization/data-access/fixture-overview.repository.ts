import { Injectable } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import { UserContext } from '@bo/types';
import { ActivityItem, ApprovalItem, Metric, Suggestion } from '../domain/overview';
import { OverviewRepository } from './overview.repository';
import {
  ACTIVITY,
  APPROVALS,
  DEPARTMENT_METRICS,
  DEPARTMENT_SUGGESTIONS,
  MEMBER_SUGGESTIONS,
  ORGANIZATION_METRICS,
  ORGANIZATION_SUGGESTIONS,
} from './fixtures/overview.fixtures';

/** Latency so loading states are exercised during development. */
const LATENCY = 120;
const respond = <T>(value: T): Observable<T> => of(value).pipe(delay(LATENCY));

/**
 * Fixture implementation. It applies the same department scoping the server
 * will, so what you see in demo matches what a real user would get.
 */
@Injectable()
export class FixtureOverviewRepository extends OverviewRepository {
  organizationMetrics(): Observable<Metric[]> {
    return respond(ORGANIZATION_METRICS);
  }

  departmentMetrics(_user: UserContext, departmentId: string): Observable<Metric[]> {
    return respond(DEPARTMENT_METRICS[departmentId] ?? []);
  }

  approvals(user: UserContext): Observable<ApprovalItem[]> {
    return respond(APPROVALS.filter((item) => this.inReach(user, item.departmentId)));
  }

  activity(user: UserContext): Observable<ActivityItem[]> {
    return respond(ACTIVITY.filter((item) => this.inReach(user, item.departmentId)));
  }

  suggestions(user: UserContext): Observable<Suggestion[]> {
    switch (user.role) {
      case 'SUPERADMIN':
        return respond(ORGANIZATION_SUGGESTIONS);
      case 'DEPARTMENT_HEAD':
        return respond(DEPARTMENT_SUGGESTIONS);
      default:
        return respond(MEMBER_SUGGESTIONS);
    }
  }

  private inReach(user: UserContext, departmentId: string): boolean {
    return user.role === 'SUPERADMIN' || departmentId === user.departmentId;
  }
}
