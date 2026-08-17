import { Injectable, inject } from '@angular/core';
import { CapabilityKey } from '@bo/types';
import { Role } from '@bo/types';
import {
  WORKSPACE_REGISTRY,
  WORKSPACE_WIDGETS,
  WorkspaceDescriptor,
  WorkspaceWidget,
} from './workspace.model';

@Injectable({ providedIn: 'root' })
export class WorkspaceRegistry {
  private readonly descriptors = inject(WORKSPACE_REGISTRY, { optional: true }) ?? [];
  private readonly widgets = inject(WORKSPACE_WIDGETS, { optional: true }) ?? [];

  /** The dashboard that answers this persona's question. */
  forRole(role: Role): WorkspaceDescriptor | undefined {
    return this.descriptors.find((d) => d.role === role);
  }

  /**
   * Widgets for a persona, keeping only those whose capability is enabled in
   * the department at hand. A superadmin dashboard passes the union of every
   * visible department's capabilities.
   */
  widgetsFor(role: Role, enabled: readonly CapabilityKey[]): WorkspaceWidget[] {
    const available = new Set(enabled);
    return this.widgets
      .filter((w) => w.role === role && available.has(w.capability))
      .sort((a, b) => a.order - b.order);
  }
}
