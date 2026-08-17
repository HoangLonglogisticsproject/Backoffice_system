import { Injectable, signal } from '@angular/core';
import { Observable, delay, of, throwError } from 'rxjs';
import { Department, Member, UserContext } from '@bo/types';
import { DepartmentRepository, SessionRepository } from '@bo/store';
import { DEPARTMENTS, MEMBERS } from './departments.fixture';
import { DEFAULT_PERSONA, PERSONAS } from './personas.fixture';

const respond = <T>(value: T): Observable<T> => of(value).pipe(delay(80));

@Injectable()
export class FixtureDepartmentRepository extends DepartmentRepository {
  list(): Observable<Department[]> {
    return respond(DEPARTMENTS);
  }

  members(departmentId: string): Observable<Member[]> {
    return respond(MEMBERS.filter((m) => m.departmentId === departmentId));
  }
}

const PERSONA_KEY = 'bo.demo.persona';

/**
 * Fixture session. `personas()` returning a non-empty list is what enables the
 * demo persona switcher — a production SessionRepository returns [] and the
 * control disappears without any UI change.
 *
 * The choice survives a reload via sessionStorage, otherwise deep-linking into
 * a page as one persona silently drops you back to the default one.
 */
@Injectable()
export class FixtureSessionRepository extends SessionRepository {
  private readonly user = signal<UserContext>(restore());

  current(): Observable<UserContext> {
    return respond(this.user());
  }

  personas(): Observable<UserContext[]> {
    return respond(PERSONAS);
  }

  switchPersona(userId: string): Observable<UserContext> {
    const next = PERSONAS.find((p) => p.userId === userId);
    if (!next) return throwError(() => new Error(`Unknown persona: ${userId}`));
    this.user.set(next);
    sessionStorage.setItem(PERSONA_KEY, userId);
    return respond(next);
  }
}

function restore(): UserContext {
  const userId = sessionStorage.getItem(PERSONA_KEY);
  return PERSONAS.find((p) => p.userId === userId) ?? DEFAULT_PERSONA;
}
