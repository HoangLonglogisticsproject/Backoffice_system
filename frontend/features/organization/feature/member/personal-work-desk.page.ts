import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { SessionStore, WorkspaceContext } from '@bo/store';
import { AccessService } from '@bo/services';
import { WidgetHost } from '@bo/services';
import { Card, EmptyState, PageHeader } from '@bo/components';
import { OverviewRepository } from '../../data-access/overview.repository';
import { SuggestionList } from '../../ui/suggestion-list';

/**
 * MEMBER — the personal work desk.
 * Question it answers: "Hôm nay tôi cần làm gì?"
 *
 * Execution-first: no department KPIs, no team roll-ups, no assignment
 * controls. Those simply are not registered for this persona, so there is
 * nothing here to hide.
 */
@Component({
  selector: 'bo-personal-work-desk',
  imports: [Card, EmptyState, PageHeader, SuggestionList, WidgetHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (department(); as dept) {
      <bo-page-header [title]="greeting()" [subtitle]="'Không gian làm việc cá nhân · ' + dept.name" />

      <bo-widget-host role="MEMBER" [capabilities]="dept.capabilities" />

      <bo-card title="Trợ lý AI" badge="Beta" [flush]="true">
        <bo-suggestion-list [items]="suggestions.value() ?? []" />
      </bo-card>
    } @else {
      <bo-empty-state
        icon="briefcase"
        message="Tài khoản của bạn chưa thuộc phòng ban nào. Liên hệ trưởng phòng để được thêm vào."
      />
    }
  `,
  styles: `
    @use 'mixins' as *;

    :host {
      display: flex;
      flex-direction: column;
      gap: var(--s-6);
      max-width: var(--page-max);

      > * {
        @include rise;
      }
      > *:nth-child(2) {
        @include rise(0.05s);
      }
      > *:nth-child(n + 3) {
        @include rise(0.1s);
      }
    }
  `,
})
export class PersonalWorkDeskPage {
  private readonly repository = inject(OverviewRepository);
  private readonly session = inject(SessionStore);
  private readonly context = inject(WorkspaceContext);

  protected readonly department = inject(AccessService).ownDepartment;

  constructor() {
    effect(() => this.context.set(this.department()));
  }

  protected greeting(): string {
    const hour = new Date().getHours();
    const part = hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
    return `${part}, ${this.session.require().name}`;
  }

  protected readonly suggestions = rxResource({
    params: () => this.session.require(),
    stream: ({ params }) => this.repository.suggestions(params),
  });
}
