import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EmptyState, PageHeader } from '@bo/components';

/**
 * Stands in for a route whose capability is not built yet, so navigation stays
 * honest instead of dead-ending. Route data supplies `title` and `note`.
 */
@Component({
  selector: 'bo-placeholder',
  imports: [EmptyState, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-page-header [title]="data['title'] ?? 'Sắp có'" />
    <bo-empty-state
      icon="package"
      [message]="data['note'] ?? 'Phân hệ này sẽ được bổ sung ở phiên bản tiếp theo.'"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--s-5);
    }
  `,
})
export class PlaceholderPage {
  protected readonly data = inject(ActivatedRoute).snapshot.data as Record<string, string | undefined>;
}
