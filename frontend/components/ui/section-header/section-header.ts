import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Row above a group of cards: section title on the left, "see all" on the right. */
@Component({
  selector: 'bo-section-header',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ title() }}</h2>
    <ng-content />
    @if (actionLabel() && actionLink()) {
      <a [routerLink]="actionLink()">{{ actionLabel() }}</a>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--s-3);
    }

    h2 {
      flex: 1;
      min-width: 0;
      font-size: var(--t-lg);
      font-weight: 650;
      letter-spacing: -0.02em;
      color: var(--fg);
    }

    a {
      padding: 2px 6px;
      margin-right: -6px;
      border-radius: var(--r-sm);
      color: var(--c-primary);
      font-size: var(--t-sm);
      font-weight: 500;
      transition: background-color 0.14s ease;

      &:hover {
        background: var(--c-primary-50);
        color: var(--c-primary-600);
      }
    }
  `,
})
export class SectionHeader {
  readonly title = input.required<string>();
  readonly actionLabel = input('');
  readonly actionLink = input<string | unknown[] | null>(null);
}
