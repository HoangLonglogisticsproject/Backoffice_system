import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const W = 100;
const H = 32;

/** Trend line with no axes or labels — context for a number, not a chart. */
@Component({
  selector: 'bo-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        [attr.points]="path()"
        fill="none"
        [attr.stroke]="tone()"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      width: 100%;
      height: 100%;
      overflow: visible;
    }
  `,
})
export class Sparkline {
  readonly points = input.required<readonly number[]>();
  readonly tone = input('var(--c-primary)');

  protected readonly w = W;
  protected readonly h = H;

  protected readonly path = computed(() => {
    const values = this.points();
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat series would divide by zero; draw it down the middle instead.
    const span = max - min || 1;
    const stepX = W / (values.length - 1);
    return values
      .map((v, i) => `${(i * stepX).toFixed(1)},${(H - ((v - min) / span) * H).toFixed(1)}`)
      .join(' ');
  });
}
