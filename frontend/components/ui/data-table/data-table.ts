import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
} from '@angular/core';
import { EmptyState } from '../../feedback/empty-state/empty-state';

export interface TableColumn {
  key: string;
  label: string;
  width?: string;
  align?: 'left' | 'right';
  /** Hidden below the desktop breakpoint — keeps mobile tables readable. */
  secondary?: boolean;
}

/**
 * Custom rendering for one column:
 *   <ng-template boCell="status" let-row>…</ng-template>
 * Columns without a template fall back to the raw value.
 */
@Directive({ selector: '[boCell]' })
export class CellDef {
  readonly boCell = input.required<string>();
  readonly template = inject(TemplateRef<{ $implicit: unknown }>);
}

@Component({
  selector: 'bo-data-table',
  imports: [NgTemplateOutlet, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rows().length) {
      <table>
        <thead>
          <tr>
            @for (column of columns(); track column.key) {
              <th
                [style.width]="column.width"
                [class.right]="column.align === 'right'"
                [class.secondary]="column.secondary"
              >
                {{ column.label }}
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of rows(); track row[trackBy()] ?? $index) {
            <tr>
              @for (column of columns(); track column.key) {
                <td
                  [attr.data-label]="column.label"
                  [class.right]="column.align === 'right'"
                  [class.secondary]="column.secondary"
                >
                  @if (cellTemplate(column.key); as template) {
                    <ng-container *ngTemplateOutlet="template; context: { $implicit: row }" />
                  } @else {
                    {{ row[column.key] }}
                  }
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <bo-empty-state [icon]="emptyIcon()" [message]="empty()" />
    }
  `,
  styleUrl: './data-table.scss',
})
export class DataTable<T extends Record<string, any>> {
  readonly columns = input.required<readonly TableColumn[]>();
  readonly rows = input.required<readonly T[]>();
  readonly empty = input('Chưa có dữ liệu.');
  readonly emptyIcon = input('inbox');
  readonly trackBy = input('id');

  private readonly cells = contentChildren(CellDef);

  private readonly templates = computed(
    () => new Map(this.cells().map((cell) => [cell.boCell(), cell.template])),
  );

  protected cellTemplate(key: string): TemplateRef<{ $implicit: unknown }> | undefined {
    return this.templates().get(key);
  }
}
