import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccessService } from '@bo/services';
import { Button, EmptyState, Icon, PageHeader } from '@bo/components';
import { DepartmentCard } from '../../ui/department-card';

/** Directory of every department the viewer may enter. */
@Component({
  selector: 'bo-departments',
  imports: [Button, DepartmentCard, EmptyState, Icon, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-page-header
      title="Phòng ban"
      subtitle="Danh sách phòng ban và năng lực đang được cấp"
    >
      <div pageActions>
        <button bo-button size="sm" variant="primary" type="button">
          <bo-icon name="plus" [size]="14" />
          Tạo phòng ban
        </button>
      </div>
    </bo-page-header>

    <div class="grid">
      @for (department of departments(); track department.id) {
        <bo-department-card [department]="department" />
      } @empty {
        <bo-empty-state icon="building" message="Chưa có phòng ban nào trong phạm vi của bạn." />
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--s-5);
      max-width: var(--page-max);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--s-4);
    }
  `,
})
export class DepartmentsPage {
  protected readonly departments = inject(AccessService).visibleDepartments;
}
