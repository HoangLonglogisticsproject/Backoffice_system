import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Type, computed, inject, resource } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { SessionStore } from '@bo/store';
import { CapabilityRegistry } from '@bo/services';
import { EmptyState, Skeleton } from '@bo/components';

/**
 * Renders the surface this persona gets for the routed capability.
 *
 * Two personas opening the same `…/<capability-key>` URL land on two different
 * components: one sees everything the unit holds, the other only their own.
 * The route is shared, the component is not — which is why neither page needs a
 * role check inside it.
 */
@Component({
  selector: 'bo-capability-outlet',
  imports: [NgComponentOutlet, EmptyState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (page.value(); as component) {
      <ng-container *ngComponentOutlet="component" />
    } @else if (page.isLoading()) {
      <bo-skeleton height="320px" />
    } @else {
      <bo-empty-state icon="package" message="Phân hệ này chưa khả dụng cho vai trò của bạn." />
    }
  `,
})
export class CapabilityOutlet {
  private readonly registry = inject(CapabilityRegistry);
  private readonly session = inject(SessionStore);
  private readonly data = toSignal(inject(ActivatedRoute).data, { initialValue: {} as Record<string, unknown> });

  /** Either a capability's persona presentation, or one of its nav contributions. */
  private readonly loader = computed(() => {
    const role = this.session.role();
    const key = String(this.data()['capability'] ?? '');
    const navPath = this.data()['nav'] as string | undefined;

    if (navPath) {
      return this.registry.navigationFor(key, role).find((n) => n.path === navPath)?.load;
    }
    return this.registry.byKey(key)?.presentations[role]?.load;
  });

  protected readonly page = resource<Type<unknown> | undefined, ReturnType<typeof this.loader>>({
    params: () => this.loader(),
    loader: ({ params }) => params?.() ?? Promise.resolve(undefined),
  });
}
