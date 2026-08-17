import { InjectionToken, Provider, Type } from '@angular/core';
import { AccentKey, CapabilityKey } from '@bo/types';
import { Role } from '@bo/types';

/**
 * A capability is a reusable software module. It is registered once and any
 * department may be configured to use it — the shell never asks "is this
 * Sales?", it asks "does this department have this capability, and what does
 * this persona see when they open it?".
 */

/** What one persona gets when they open a capability. */
export interface CapabilityPresentation {
  /**
   * Persona-facing name. The same capability is usually worded differently per
   * scope — a unit-wide list vs "mine" — which is why the title lives on the
   * presentation and not on the capability.
   */
  title: string;
  icon?: string;
  load: () => Promise<Type<unknown>>;
}

/** An extra nav entry a capability contributes inside a department workspace. */
export interface NavigationContribution {
  /** Path segment under /departments/:slug. */
  path: string;
  title: string;
  icon: string;
  /** Personas that see it. Omit = every persona that can use the capability. */
  roles?: Role[];
  load: () => Promise<Type<unknown>>;
}

export interface CapabilityDescriptor {
  key: CapabilityKey;
  /** Neutral name, used where no persona context exists (settings, dept cards). */
  title: string;
  icon: string;
  accent: AccentKey;
  /**
   * Missing role ⇒ that persona does not see this capability at all — not in
   * navigation, not in tabs, and the route guard refuses it.
   *
   * This is how a persona loses a whole surface without a single
   * `if (role === …)` anywhere in the shell: the surface was never registered
   * for them, so there is nothing to hide.
   */
  presentations: Partial<Record<Role, CapabilityPresentation>>;
  navigation?: NavigationContribution[];
}

export const CAPABILITY_REGISTRY = new InjectionToken<CapabilityDescriptor[]>('CAPABILITY_REGISTRY');

/** Composition root helper: `provideCapabilities(salesCapabilities, hrCapabilities)`. */
export function provideCapabilities(...groups: readonly CapabilityDescriptor[][]): Provider {
  return { provide: CAPABILITY_REGISTRY, useValue: groups.flat() };
}
