import { Injectable, computed, inject } from '@angular/core';
import { CapabilityRegistry } from '../composition/capability.registry';
import { CapabilityDescriptor, CapabilityPresentation } from '../composition/capability.model';
import { CapabilityKey, Department, UserContext } from '@bo/types';
import { OrgStore } from '../../store/organization/org.store';
import { SessionStore } from '../../store/session/session.store';
import { Role } from '@bo/types';
import { canAccessUnit, canConfigureUnit, visibleUnits } from './rules/unit-access';

/**
 * Before the session resolves there is still a first render, and guards may
 * already run. Standing in for the missing user with the least-privileged
 * shape keeps every rule fail-closed instead of scattering null checks.
 */
const ANONYMOUS: UserContext = { userId: '', name: '', title: '', role: 'MEMBER' };

/**
 * The Angular face of authorization. It holds **no rules of its own** — every
 * decision below is delegated to a pure function in `rules/`, which is what
 * lets a backend enforce exactly the same thing from the same source.
 *
 * What this class adds is the wiring the rules must not know about: reactive
 * signals, the session and org stores, and the capability registry.
 *
 * Three levels, deliberately not merged:
 *   L1  which units may I enter?       rules/unit-access.ts
 *   L2  whose records may I read?      rules/record-access.ts (used in repositories)
 *   L3  what does my persona open?     here — it reads the registry, so it is
 *                                      frontend-only and has no server mirror
 */
@Injectable({ providedIn: 'root' })
export class AccessService {
  private readonly session = inject(SessionStore);
  private readonly org = inject(OrgStore);
  private readonly registry = inject(CapabilityRegistry);

  /** Who the rules are being asked about. */
  private readonly actor = computed<UserContext>(() => this.session.context() ?? ANONYMOUS);

  readonly role = this.session.role;
  readonly isSuperadmin = this.session.isSuperadmin;

  /** Head Sales must not see Marketing, Operations, Finance or IT. */
  readonly visibleDepartments = computed<Department[]>(() =>
    visibleUnits(this.org.departments(), this.actor()),
  );

  /** The unit a head/member lives in; for a superadmin, none in particular. */
  readonly ownDepartment = computed<Department | undefined>(() =>
    this.org.byId(this.session.departmentId()),
  );

  canViewDepartment(departmentId: string | undefined): boolean {
    return canAccessUnit(this.actor(), departmentId);
  }

  canConfigureDepartment(departmentId: string): boolean {
    return canConfigureUnit(this.actor(), departmentId);
  }

  /**
   * L3. Enabled on the department ∩ registered in code ∩ has a presentation for
   * this persona. Registry order wins so navigation is stable.
   */
  capabilitiesFor(department: Department | undefined, role: Role = this.role()): CapabilityDescriptor[] {
    if (!department || !this.canViewDepartment(department.id)) return [];
    const enabled = new Set(department.capabilities);
    return this.registry.all().filter((c) => enabled.has(c.key) && !!c.presentations[role]);
  }

  canUseCapability(department: Department | undefined, key: CapabilityKey): boolean {
    return this.capabilitiesFor(department).some((c) => c.key === key);
  }

  /** What this persona actually opens for a capability. */
  presentationFor(key: CapabilityKey, role: Role = this.role()): CapabilityPresentation | undefined {
    return this.registry.byKey(key)?.presentations[role];
  }

  /** Capabilities a head could still propose to the superadmin. */
  proposableCapabilities(department: Department): CapabilityDescriptor[] {
    return this.registry.all().filter((c) => !department.capabilities.includes(c.key));
  }
}
