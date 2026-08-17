import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { OrgStore, SessionStore, WorkspaceContext } from '@bo/store';
import { AccessService, CapabilityRegistry } from '@bo/services';
import { Badge, EmptyState, Icon } from '@bo/components';
import { accentVars } from '@bo/utils';

/**
 * Frame for /departments/:slug. The tab strip is the persona's capability
 * presentations — a head and a member on the same department see different
 * tabs because different presentations are registered, not because this
 * component checks a role.
 */
@Component({
  selector: 'bo-department-workspace',
  imports: [Badge, EmptyState, Icon, RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (department(); as dept) {
      <header [style]="vars()">
        <span class="tile"><bo-icon [name]="dept.icon" [size]="22" /></span>
        <div class="identity">
          <h1>{{ dept.name }}</h1>
          <p>{{ dept.description }}</p>
        </div>
        <bo-badge tone="success" [dot]="true">{{ dept.memberCount }} thành viên</bo-badge>
      </header>

      <nav class="tabs">
        @for (tab of tabs(); track tab.link) {
          <a [routerLink]="tab.link" routerLinkActive="active">
            <bo-icon [name]="tab.icon" [size]="14" />
            {{ tab.label }}
          </a>
        } @empty {
          <p class="empty-tabs">Phòng ban này chưa được cấp năng lực nào.</p>
        }
      </nav>

      <router-outlet />
    } @else {
      <bo-empty-state icon="building" message="Không tìm thấy phòng ban." />
    }
  `,
  styleUrl: './department-workspace.page.scss',
})
export class DepartmentWorkspacePage {
  /** Bound from the route parameter via withComponentInputBinding(). */
  readonly slug = input<string>('');

  private readonly org = inject(OrgStore);
  private readonly access = inject(AccessService);
  private readonly session = inject(SessionStore);
  private readonly registry = inject(CapabilityRegistry);
  private readonly context = inject(WorkspaceContext);

  protected readonly department = computed(() => this.org.bySlug(this.slug()));
  protected readonly vars = computed(() => accentVars(this.department()?.accent));

  protected readonly tabs = computed(() => {
    const dept = this.department();
    const role = this.session.role();
    if (!dept) return [];

    return this.access.capabilitiesFor(dept, role).flatMap((capability) => {
      const contributions = this.registry.navigationFor(capability.key, role);
      if (contributions.length) {
        return contributions.map((nav) => ({
          label: nav.title,
          icon: nav.icon,
          link: `/departments/${dept.slug}/${nav.path}`,
        }));
      }
      const presentation = capability.presentations[role];
      return presentation
        ? [
            {
              label: presentation.title,
              icon: presentation.icon ?? capability.icon,
              link: `/departments/${dept.slug}/${capability.key}`,
            },
          ]
        : [];
    });
  });

  constructor() {
    effect(() => this.context.set(this.department()));
  }
}
