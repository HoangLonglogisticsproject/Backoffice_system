import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { UserContext } from '@bo/types';
import { OrgStore, SessionStore } from '@bo/store';
import { Icon } from '@bo/components';

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Superadmin',
  DEPARTMENT_HEAD: 'Trưởng phòng',
  MEMBER: 'Nhân viên',
};

/**
 * DEMO ONLY. Lets a reviewer see each persona's workspace without six logins.
 *
 * It renders solely because the fixture SessionRepository returns a persona
 * list; a production repository returns [] and this disappears. Real users
 * never change their own role.
 */
@Component({
  selector: 'bo-persona-switcher',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="btn btn--sm trigger" type="button" (click)="open.set(!open())">
      <bo-icon name="users" [size]="13" />
      {{ label(session.context()) }}
      <bo-icon name="chevron-down" [size]="12" />
    </button>

    @if (open()) {
      <div class="menu" role="menu">
        <p class="hint">Chế độ demo — xem workspace theo persona</p>
        @for (persona of session.personas(); track persona.userId) {
          <button
            type="button"
            role="menuitem"
            class="option"
            [class.option--active]="persona.userId === session.context()?.userId"
            (click)="pick(persona.userId)"
          >
            <span class="who">{{ persona.name }}</span>
            <span class="role">{{ label(persona) }}</span>
          </button>
        }
      </div>
    }
  `,
  styleUrl: './persona-switcher.scss',
})
export class PersonaSwitcher {
  protected readonly session = inject(SessionStore);
  private readonly org = inject(OrgStore);
  protected readonly open = signal(false);

  protected label(persona: UserContext | null): string {
    if (!persona) return '';
    const role = ROLE_LABEL[persona.role] ?? persona.role;
    const department = this.org.byId(persona.departmentId)?.name;
    return department ? `${role} · ${department}` : role;
  }

  protected async pick(userId: string): Promise<void> {
    this.open.set(false);
    await this.session.switchPersona(userId);
  }
}
