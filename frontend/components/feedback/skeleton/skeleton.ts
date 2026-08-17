import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Loading placeholder. Used by the widget host while a lazy panel resolves. */
@Component({
  selector: 'bo-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.height]': 'height()', '[style.width]': 'width()', 'aria-hidden': 'true' },
  template: ``,
  styles: `
    :host {
      display: block;
      border-radius: var(--r-md);
      background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-subtle) 50%, var(--bg-hover) 75%);
      background-size: 400% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }

    @keyframes shimmer {
      from {
        background-position: 100% 0;
      }
      to {
        background-position: 0 0;
      }
    }
  `,
})
export class Skeleton {
  readonly height = input('16px');
  readonly width = input('100%');
}
