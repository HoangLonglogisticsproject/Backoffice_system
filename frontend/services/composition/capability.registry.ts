import { Injectable, inject } from '@angular/core';
import { CapabilityKey } from '@bo/types';
import { Role } from '@bo/types';
import { CAPABILITY_REGISTRY, CapabilityDescriptor, NavigationContribution } from './capability.model';

/** Read-only view over the capabilities the composition root registered. */
@Injectable({ providedIn: 'root' })
export class CapabilityRegistry {
  private readonly descriptors = inject(CAPABILITY_REGISTRY, { optional: true }) ?? [];
  private readonly index = new Map(this.descriptors.map((d) => [d.key, d]));

  all(): CapabilityDescriptor[] {
    return this.descriptors;
  }

  byKey(key: CapabilityKey): CapabilityDescriptor | undefined {
    return this.index.get(key);
  }

  /** Sub-navigation a capability contributes, filtered to one persona. */
  navigationFor(key: CapabilityKey, role: Role): NavigationContribution[] {
    return (this.byKey(key)?.navigation ?? []).filter((n) => !n.roles || n.roles.includes(role));
  }
}
