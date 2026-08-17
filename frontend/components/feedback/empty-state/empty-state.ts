import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon } from '../../ui/icon/icon';

@Component({
  selector: 'bo-empty-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-icon [name]="icon()" [size]="22" />
    <p>{{ message() }}</p>
    <ng-content />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--s-2);
      padding: var(--s-8) var(--s-4);
      color: var(--fg-subtle);
      text-align: center;
    }

    p {
      font-size: var(--t-base);
      max-width: 40ch;
    }
  `,
})
export class EmptyState {
  readonly message = input('Chưa có dữ liệu.');
  readonly icon = input('inbox');
}
