import { Injectable, computed, inject, signal } from '@angular/core';
import { Department } from '@bo/types';
import { SessionStore } from '@bo/store';
import { AccessService, CapabilityRegistry } from '@bo/services';
import { NavGroup, NavigationModel } from '@bo/components';
import { SHELL_NAVIGATION, ShellNavItem } from './navigation.model';

export interface DepartmentNavGroup {
  department: Department;
  link: string;
  children: Array<{ label: string; icon: string; link: string }>;
  /** Own department, or the only one in reach — opened by default. */
  expandedByDefault: boolean;
}

/**
 * THE MAPPING. This is the seam that keeps the navigation component reusable.
 *
 * Everything business-shaped stops here: departments, roles, capability
 * presentations, tenant configuration. What leaves is a NavigationModel — plain
 * labels, icons and links that any customer's product could produce.
 *
 * Move this file to another project and it is the only one you rewrite.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  private readonly access = inject(AccessService);
  private readonly session = inject(SessionStore);
  private readonly capabilities = inject(CapabilityRegistry);
  private readonly config = inject(SHELL_NAVIGATION, { optional: true });

  readonly primary = computed(() => this.forRole(this.config?.primary ?? []));
  readonly secondary = computed(() => this.forRole(this.config?.secondary ?? []));

  readonly departments = computed<DepartmentNavGroup[]>(() => {
    const role = this.session.role();
    const own = this.session.departmentId();

    return this.access.visibleDepartments().map((department) => {
      const link = `/departments/${department.slug}`;

      // A capability contributes either its persona presentation, or a set of
      // finer-grained nav entries when it has several surfaces.
      const children = this.access.capabilitiesFor(department, role).flatMap((capability) => {
        const contributions = this.capabilities.navigationFor(capability.key, role);
        if (contributions.length) {
          return contributions.map((nav) => ({
            label: nav.title,
            icon: nav.icon,
            link: `${link}/${nav.path}`,
          }));
        }
        const presentation = capability.presentations[role];
        return presentation
          ? [
              {
                label: presentation.title,
                icon: presentation.icon ?? capability.icon,
                link: `${link}/${capability.key}`,
              },
            ]
          : [];
      });

      return { department, link, children, expandedByDefault: department.id === own };
    });
  });

  private forRole(items: readonly ShellNavItem[]): ShellNavItem[] {
    const role = this.session.role();
    return items.filter((item) => !item.roles || item.roles.includes(role));
  }

  /* --- expansion state ----------------------------------------------------
   * Held here rather than inside the sidebar so it survives a switch between
   * the sidebar, the rail and the drawer — those are three presentations of
   * the same navigation, and collapsing a group should not depend on which one
   * happens to be mounted.
   *
   * Only groups the user has explicitly toggled are recorded; the rest follow
   * their default.
   */
  private readonly overrides = signal<Record<string, boolean>>({});

  /** Read by the navigation component; it holds no state of its own. */
  readonly expansion = this.overrides.asReadonly();

  isExpanded(groupId: string, fallback: boolean): boolean {
    return this.overrides()[groupId] ?? fallback;
  }

  toggle(groupId: string, fallback: boolean): void {
    const next = !this.isExpanded(groupId, fallback);
    this.overrides.update((state) => ({ ...state, [groupId]: next }));
  }

  /** Toggle by id alone — the component reports which group, not what state. */
  toggleById(groupId: string): void {
    const group = this.departments().find((g) => g.department.id === groupId);
    this.toggle(groupId, group?.expandedByDefault ?? false);
  }

  /**
   * The application's data, restated in the navigation's own vocabulary.
   * Section headings are the tenant's words, so they travel with the model.
   */
  readonly model = computed<NavigationModel>(() => ({
    primary: this.primary(),
    groups: this.departments().map<NavGroup>((group) => ({
      id: group.department.id,
      label: group.department.name,
      icon: group.department.icon,
      link: group.link,
      accent: group.department.accent,
      children: group.children,
      expandedByDefault: group.expandedByDefault,
    })),
    groupsLabel: this.config?.groupsLabel ?? '',
    secondary: this.secondary(),
    secondaryLabel: this.config?.secondaryLabel ?? '',
  }));
}
