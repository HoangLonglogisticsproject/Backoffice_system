import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { Department } from '@bo/types';
import { AccessService } from './access.service';
import { isRole } from './rules/scope';

/**
 * Structural guard for small UI bits:
 *
 *   <button *boCan="'SUPERADMIN'">Settings</button>
 *   <a *boCan="'<capability-key>'; in: department">…</a>
 *
 * A role name checks the persona; anything else is a capability key.
 * For whole panels prefer a workspace widget — hiding buttons on a shared
 * dashboard is exactly the pattern this architecture avoids.
 */
@Directive({ selector: '[boCan]' })
export class CanDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly access = inject(AccessService);

  readonly boCan = input.required<string>();
  readonly boCanIn = input<Department | undefined>(undefined);

  private rendered = false;

  constructor() {
    effect(() => {
      const allowed = this.evaluate();
      if (allowed === this.rendered) return;
      this.rendered = allowed;
      if (allowed) this.container.createEmbeddedView(this.template);
      else this.container.clear();
    });
  }

  private evaluate(): boolean {
    const token = this.boCan();
    return isRole(token)
      ? this.access.role() === token
      : this.access.canUseCapability(this.boCanIn(), token);
  }
}
