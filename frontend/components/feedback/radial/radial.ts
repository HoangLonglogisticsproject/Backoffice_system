import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { accentVars } from '@bo/utils';

const SIZE = 44;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/**
 * A single ratio, drawn as a ring with its value inside. Used where a
 * percentage is the headline itself — a conversion rate, a completion — not as
 * decoration beside a number that already says it.
 */
@Component({
  selector: 'bo-radial',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style]': 'vars()' },
  template: `
    <svg [attr.width]="size" [attr.height]="size" [attr.viewBox]="'0 0 ' + size + ' ' + size">
      <circle
        [attr.cx]="half"
        [attr.cy]="half"
        [attr.r]="r"
        fill="none"
        stroke="var(--accent-soft)"
        [attr.stroke-width]="stroke"
      />
      <circle
        [attr.cx]="half"
        [attr.cy]="half"
        [attr.r]="r"
        fill="none"
        stroke="var(--accent)"
        [attr.stroke-width]="stroke"
        stroke-linecap="round"
        [attr.stroke-dasharray]="circumference"
        [attr.stroke-dashoffset]="offset()"
        [attr.transform]="'rotate(-90 ' + half + ' ' + half + ')'"
      />
    </svg>
    <span class="value">{{ label() }}</span>
  `,
  styles: `
    :host {
      position: relative;
      display: grid;
      place-items: center;
      flex: none;
    }

    svg {
      display: block;
    }

    circle {
      transition: stroke-dashoffset 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .value {
      position: absolute;
      font-size: var(--t-xs);
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--fg);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Radial {
  /** 0–100. */
  readonly value = input.required<number>();
  readonly accent = input('blue');
  /** Defaults to the rounded percentage; override for a shorter form. */
  readonly label = input.required<string>();

  protected readonly size = SIZE;
  protected readonly half = SIZE / 2;
  protected readonly r = R;
  protected readonly stroke = STROKE;
  protected readonly circumference = C.toFixed(2);

  protected readonly vars = computed(() => accentVars(this.accent()));
  protected readonly offset = computed(() =>
    (C * (1 - Math.min(100, Math.max(0, this.value())) / 100)).toFixed(2),
  );
}
