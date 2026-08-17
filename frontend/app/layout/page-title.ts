import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

/**
 * Title shown in the topbar. Reads `title` from the deepest active route; a
 * page may override it when the title depends on loaded data.
 *
 * Walks Router.routerState rather than injecting ActivatedRoute — the latter
 * is only available inside a routed component's injector, not at root.
 */
@Injectable({ providedIn: 'root' })
export class PageTitle {
  private readonly router = inject(Router);
  private readonly override = signal<string | null>(null);

  private readonly fromRoute = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => {
        // A title set by the previous page must not leak into the next one.
        this.override.set(null);
        // Mid-navigation a child route may not have a snapshot yet.
        let route = this.router.routerState.root;
        while (route.firstChild) route = route.firstChild;
        return (route.snapshot?.data['title'] as string | undefined) ?? '';
      }),
    ),
    { initialValue: '' },
  );

  readonly title = computed(() => this.override() ?? this.fromRoute());

  set(title: string | null): void {
    this.override.set(title);
  }
}
