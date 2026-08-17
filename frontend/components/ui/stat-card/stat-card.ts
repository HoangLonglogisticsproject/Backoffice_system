import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { accentVars } from '@bo/utils';
import { Icon } from '../icon/icon';
import { Sparkline } from '../sparkline/sparkline';

/** Headline metric: tinted icon tile, value, signed delta and a trend line. */
@Component({
  selector: 'bo-stat-card',
  imports: [Icon, Sparkline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style]': 'vars()' },
  template: `
    <div class="tile"><bo-icon [name]="icon()" [size]="20" /></div>
    <div class="content">
      <p class="label">{{ label() }}</p>
      <!-- Value and trend share a row so the label always gets full width. -->
      <div class="row">
        <strong class="value">{{ value() }}</strong>
        @if (delta() !== null) {
          <span class="delta" [class.delta--down]="!rising()">
            <bo-icon [name]="rising() ? 'trending-up' : 'trending-down'" [size]="12" />
            {{ absDelta() }}%
          </span>
        }
        @if (trend().length) {
          <bo-sparkline class="spark" [points]="trend()" [tone]="sparkTone()" />
        }
      </div>
      <p class="hint">{{ hint() }}</p>
    </div>
  `,
  styleUrl: './stat-card.scss',
})
export class StatCard {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly hint = input('');
  readonly icon = input('activity');
  readonly accent = input('slate');
  /** null hides the chip entirely — not every metric has a comparison. */
  readonly delta = input<number | null>(null);
  readonly trend = input<readonly number[]>([]);
  /** Some metrics improve when they fall (overdue work, churn). */
  readonly invertDelta = input(false);

  protected readonly vars = computed(() => accentVars(this.accent()));
  protected readonly rising = computed(() => (this.delta() ?? 0) >= 0);
  protected readonly absDelta = computed(() => Math.abs(this.delta() ?? 0));

  /** Green when the movement is good news, red when it is not. */
  protected readonly sparkTone = computed(() => {
    const delta = this.delta();
    if (delta === null) return 'var(--accent)';
    const good = this.invertDelta() ? delta < 0 : delta >= 0;
    return good ? 'var(--c-green)' : 'var(--c-rose)';
  });
}
