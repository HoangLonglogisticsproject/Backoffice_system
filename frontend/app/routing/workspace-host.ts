import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Type, computed, inject, resource } from '@angular/core';
import { SessionStore } from '@bo/store';
import { WorkspaceRegistry } from '@bo/services';
import { EmptyState, Skeleton } from '@bo/components';

/**
 * The `/` route for every persona — and a different page for each of them.
 *
 * A superadmin gets an organization control centre, a head gets their
 * department's control centre, a member gets their own work desk. Same URL,
 * different composition; no dashboard hides widgets from anyone.
 */
@Component({
  selector: 'bo-workspace-host',
  imports: [NgComponentOutlet, EmptyState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dashboard.value(); as component) {
      <ng-container *ngComponentOutlet="component" />
    } @else if (dashboard.isLoading()) {
      <div class="loading">
        <bo-skeleton height="28px" width="40%" />
        <bo-skeleton height="88px" />
        <bo-skeleton height="220px" />
      </div>
    } @else {
      <bo-empty-state
        icon="layout-dashboard"
        message="Chưa có workspace nào được đăng ký cho vai trò này."
      />
    }
  `,
  styles: `
    .loading {
      display: flex;
      flex-direction: column;
      gap: var(--s-4);
    }
  `,
})
export class WorkspaceHost {
  private readonly registry = inject(WorkspaceRegistry);
  private readonly session = inject(SessionStore);

  private readonly descriptor = computed(() => this.registry.forRole(this.session.role()));

  protected readonly dashboard = resource<Type<unknown> | undefined, ReturnType<typeof this.descriptor>>({
    params: () => this.descriptor(),
    loader: ({ params }) => params?.loadDashboard() ?? Promise.resolve(undefined),
  });
}
