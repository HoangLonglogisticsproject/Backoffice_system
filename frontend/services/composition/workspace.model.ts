import { InjectionToken, Provider, Type } from '@angular/core';
import { CapabilityKey } from '@bo/types';
import { Role } from '@bo/types';

/**
 * Scope does not merely gate buttons — it selects an entirely different
 * workspace. Each persona opens the day with a different question, so each gets
 * its own dashboard component and its own set of widgets:
 *
 *   organization-wide  → how is the whole organization running?
 *   unit-wide          → how is my unit running?
 *   self               → what do I need to do today?
 *
 * Collapsing these into one dashboard that hides widgets is the anti-pattern
 * this registry exists to prevent.
 */
export interface WorkspaceDescriptor {
  role: Role;
  loadDashboard: () => Promise<Type<unknown>>;
}

/**
 * A panel a capability contributes to one persona's dashboard. The dashboard
 * does not import widgets; it renders whatever was registered and permitted.
 */
export interface WorkspaceWidget {
  id: string;
  /** Rendered only if the department in context has this capability enabled. */
  capability: CapabilityKey;
  role: Role;
  /** Ascending. Leaves room between values so tenants can insert their own. */
  order: number;
  /** Columns spanned on the dashboard's 3-column grid. */
  span?: 1 | 2 | 3;
  load: () => Promise<Type<unknown>>;
}

export const WORKSPACE_REGISTRY = new InjectionToken<WorkspaceDescriptor[]>('WORKSPACE_REGISTRY');
export const WORKSPACE_WIDGETS = new InjectionToken<WorkspaceWidget[]>('WORKSPACE_WIDGETS');

export function provideWorkspaces(descriptors: readonly WorkspaceDescriptor[]): Provider {
  return { provide: WORKSPACE_REGISTRY, useValue: [...descriptors] };
}

export function provideWorkspaceWidgets(...groups: readonly WorkspaceWidget[][]): Provider {
  return { provide: WORKSPACE_WIDGETS, useValue: groups.flat() };
}
