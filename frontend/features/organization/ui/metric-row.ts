import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { StatCard } from '@bo/components';
import { Metric } from '../domain/overview';

/** Responsive row of headline metrics. Auto-fits so 4 or 5 both look right. */
@Component({
  selector: 'bo-metric-row',
  imports: [StatCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (metric of metrics(); track metric.key) {
      <bo-stat-card
        [label]="metric.label"
        [value]="metric.value"
        [hint]="metric.hint ?? ''"
        [icon]="metric.icon"
        [accent]="metric.accent"
        [delta]="metric.delta ?? null"
        [invertDelta]="metric.invertDelta ?? false"
        [trend]="metric.trend ?? []"
      />
    }
  `,
  styles: `
    :host {
      display: grid;
      /* Narrow enough that a five-metric department row still fits on one line. */
      grid-template-columns: repeat(auto-fit, minmax(208px, 1fr));
      gap: var(--s-3);
    }

    @media (max-width: 899px) {
      :host {
        grid-template-columns: repeat(auto-fit, minmax(158px, 1fr));
      }
    }
  `,
})
export class MetricRow {
  readonly metrics = input.required<readonly Metric[]>();
}
