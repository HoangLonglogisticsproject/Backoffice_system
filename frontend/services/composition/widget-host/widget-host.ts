import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CapabilityKey } from '@bo/types';
import { WorkspaceRegistry, WorkspaceWidget } from '@bo/services';
import { Role } from '@bo/types';
import { LazyWidget } from '../lazy-widget/lazy-widget';

/**
 * Lays out the widgets registered for one persona, keeping only those whose
 * capability is enabled for the department in play. A dashboard never imports
 * a widget — it declares which persona it is and what is available.
 */
@Component({
  selector: 'bo-widget-host',
  imports: [LazyWidget],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (widget of widgets(); track widget.id) {
      <bo-lazy-widget [widget]="widget" [style.--span]="widget.span ?? 1" />
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--s-4);
      align-items: start;
    }

    bo-lazy-widget {
      grid-column: span var(--span, 1);
      min-width: 0;
    }

    @media (max-width: 1279px) {
      :host {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      bo-lazy-widget {
        grid-column: span min(var(--span, 1), 2);
      }
    }

    @media (max-width: 899px) {
      :host {
        grid-template-columns: minmax(0, 1fr);
      }
      bo-lazy-widget {
        grid-column: span 1;
      }
    }
  `,
})
export class WidgetHost {
  readonly role = input.required<Role>();
  /** Capabilities in play: one department's, or the union across an organization. */
  readonly capabilities = input.required<readonly CapabilityKey[]>();

  private readonly registry = inject(WorkspaceRegistry);

  protected readonly widgets = computed<WorkspaceWidget[]>(() =>
    this.registry.widgetsFor(this.role(), this.capabilities()),
  );
}
