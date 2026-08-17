import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UserContext } from '@bo/types';
import { SessionRepository } from './session.repository';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  private readonly repository = inject(SessionRepository);

  private readonly _context = signal<UserContext | null>(null);
  private readonly _personas = signal<UserContext[]>([]);

  readonly context = this._context.asReadonly();
  readonly personas = this._personas.asReadonly();

  readonly role = computed(() => this._context()?.role ?? 'MEMBER');
  readonly isSuperadmin = computed(() => this.role() === 'SUPERADMIN');
  readonly isHead = computed(() => this.role() === 'DEPARTMENT_HEAD');
  readonly departmentId = computed(() => this._context()?.departmentId);

  /** Persona switching is a fixture-mode affordance, never a production feature. */
  readonly canSwitchPersona = computed(() => this._personas().length > 0);

  async load(): Promise<void> {
    const [context, personas] = await Promise.all([
      firstValueFrom(this.repository.current()),
      firstValueFrom(this.repository.personas()),
    ]);
    this._context.set(context);
    this._personas.set(personas);
  }

  async switchPersona(userId: string): Promise<void> {
    this._context.set(await firstValueFrom(this.repository.switchPersona(userId)));
  }

  /** Non-null context for code that already ran behind the auth guard. */
  require(): UserContext {
    const context = this._context();
    if (!context) throw new Error('SessionStore: no user context loaded');
    return context;
  }
}
