import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EmptyState, Icon } from '@bo/components';
import { accentVars } from '@bo/utils';
import { Suggestion } from '../domain/overview';

@Component({
  selector: 'bo-suggestion-list',
  imports: [EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (item of items(); track item.id) {
      <button class="row" type="button" [style]="vars(item.accent)">
        <span class="tile"><bo-icon [name]="item.icon" [size]="15" /></span>
        <span class="body">
          <span class="title">{{ item.title }}</span>
          <span class="text">{{ item.body }}</span>
        </span>
        <bo-icon name="chevron-right" [size]="14" />
      </button>
    } @empty {
      <bo-empty-state icon="sparkles" message="Chưa có gợi ý nào." />
    }
  `,
  styleUrl: './suggestion-list.scss',
})
export class SuggestionList {
  readonly items = input.required<readonly Suggestion[]>();

  protected vars(accent: string) {
    return accentVars(accent);
  }
}
