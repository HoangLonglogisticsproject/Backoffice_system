import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

export type Layout = 'full' | 'rail' | 'drawer';

/**
 * One place that decides which of the three shell layouts applies, so no
 * component re-implements the breakpoints.
 * ponytail: matchMedia, no ResizeObserver and no CDK layout package.
 */
@Injectable({ providedIn: 'root' })
export class Viewport {
  private readonly window = inject(DOCUMENT).defaultView;

  private readonly narrow = this.watch('(max-width: 899px)');
  private readonly medium = this.watch('(max-width: 1279px)');

  readonly layout = computed<Layout>(() =>
    this.narrow() ? 'drawer' : this.medium() ? 'rail' : 'full',
  );

  private watch(query: string) {
    const state = signal(false);
    const media = this.window?.matchMedia(query);
    if (media) {
      state.set(media.matches);
      media.addEventListener('change', (event) => state.set(event.matches));
    }
    return state.asReadonly();
  }
}
