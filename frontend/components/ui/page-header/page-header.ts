import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Title block at the top of a page. Actions go in the `[pageActions]` slot. */
@Component({
  selector: 'bo-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="titles">
      <h1>{{ title() }}</h1>
      @if (subtitle(); as text) {
        <p>{{ text }}</p>
      }
    </div>
    <div class="actions"><ng-content select="[pageActions]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: var(--s-4);
      flex-wrap: wrap;
    }

    .titles {
      flex: 1;
      min-width: 200px;
    }

    h1 {
      font-size: var(--t-xl);
      font-weight: 650;
      letter-spacing: -0.025em;
      color: var(--fg);
    }

    p {
      margin-top: 3px;
      color: var(--fg-muted);
      font-size: var(--t-md);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--s-2);
      flex-wrap: wrap;
    }

    @media (max-width: 899px) {
      h1 {
        font-size: 18px;
      }

      p {
        font-size: var(--t-base);
      }

      .actions {
        width: 100%;
      }
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}
