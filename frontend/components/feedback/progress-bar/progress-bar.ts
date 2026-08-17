import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { accentVars } from '@bo/utils';

/** Proportion bar used by workload and conversion panels. */
@Component({
  selector: 'bo-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style]': 'vars()',
    role: 'progressbar',
    '[attr.aria-valuenow]': 'percent()',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-label]': 'label()',
  },
  template: `<span [style.scale]="percent() / 100 + ' 1'"></span>`,
  styles: `
    :host {
      display: block;
      height: 6px;
      border-radius: var(--r-full);
      background: var(--accent-soft);
      overflow: hidden;
    }

    /* Scaled rather than resized: a transform animates off the layout thread. */
    span {
      display: block;
      width: 100%;
      height: 100%;
      transform-origin: left center;
      border-radius: inherit;
      background: var(--accent);
      transition: scale 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
  `,
})
export class ProgressBar {
  readonly value = input.required<number>();
  readonly max = input(100);
  readonly accent = input('blue');
  readonly label = input('');

  protected readonly vars = computed(() => accentVars(this.accent()));
  protected readonly percent = computed(() => {
    const max = this.max() || 1;
    return Math.min(100, Math.max(0, (this.value() / max) * 100));
  });
}
