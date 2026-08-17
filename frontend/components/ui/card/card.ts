import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../icon/icon';

/**
 * The panel every dashboard widget sits in: title row with an optional action
 * link, then projected content. Slot `[cardActions]` replaces the default link.
 */
@Component({
  selector: 'bo-card',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (title() || actionLabel()) {
      <header class="head">
        <div class="titles">
          <h3 class="title">
            {{ title() }}
            @if (badge(); as text) {
              <span class="tag">{{ text }}</span>
            }
          </h3>
          @if (subtitle(); as text) {
            <p class="subtitle">{{ text }}</p>
          }
        </div>
        <ng-content select="[cardActions]">
          @if (actionLabel() && actionLink()) {
            <a class="action" [routerLink]="actionLink()">
              {{ actionLabel() }}
              <bo-icon name="chevron-right" [size]="14" />
            </a>
          }
        </ng-content>
      </header>
    }
    <div class="body" [class.body--flush]="flush()">
      <ng-content />
    </div>
    <ng-content select="[cardFooter]" />
  `,
  styleUrl: './card.scss',
})
export class Card {
  readonly title = input('');
  readonly subtitle = input('');
  /** Small uppercase tag next to the title, e.g. BETA. */
  readonly badge = input('');
  readonly actionLabel = input('');
  readonly actionLink = input<string | unknown[] | null>(null);
  /** Removes body padding for edge-to-edge content such as tables. */
  readonly flush = input(false);
}
