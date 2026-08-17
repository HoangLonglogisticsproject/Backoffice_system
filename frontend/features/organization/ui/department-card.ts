import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Department } from '@bo/types';
import { AccessService } from '@bo/services';
import { Badge, Icon } from '@bo/components';
import { accentVars } from '@bo/utils';

/** Beyond this the icon strip wraps and the cards stop lining up. */
const MAX_ICONS = 3;

/**
 * One department, rendered entirely from its record — icon, accent, copy and
 * the capability icons all come from data, so a department created tomorrow
 * looks native without a code change.
 */
@Component({
  selector: 'bo-department-card',
  imports: [Badge, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style]': 'vars()' },
  template: `
    <a class="link" [routerLink]="['/departments', department().slug]">
      <span class="tile"><bo-icon [name]="department().icon" [size]="20" /></span>
      <span class="name">{{ department().name }}</span>
    </a>

    <p class="description">{{ department().description }}</p>

    <bo-badge tone="success" [dot]="true">{{
      department().active ? 'Đang hoạt động' : 'Tạm dừng'
    }}</bo-badge>

    <div class="capabilities">
      <p class="caption">Năng lực</p>
      <div class="icons">
        @for (capability of shown(); track capability.key) {
          <span class="chip" [style]="chipVars(capability.accent)" [title]="capability.title">
            <bo-icon [name]="capability.icon" [size]="14" />
          </span>
        } @empty {
          <span class="caption">Chưa cấp năng lực nào</span>
        }
        @if (overflow(); as extra) {
          <span class="chip chip--more" [title]="overflowTitle()">+{{ extra }}</span>
        }
      </div>
    </div>
  `,
  styleUrl: './department-card.scss',
})
export class DepartmentCard {
  readonly department = input.required<Department>();

  private readonly access = inject(AccessService);

  protected readonly vars = computed(() => accentVars(this.department().accent));

  /** Only capabilities the viewer could actually open — no teasing. */
  protected readonly capabilities = computed(() => this.access.capabilitiesFor(this.department()));

  /** Keep the icon strip to one line whatever a department is configured with. */
  protected readonly shown = computed(() => this.capabilities().slice(0, MAX_ICONS));
  protected readonly overflow = computed(() => this.capabilities().length - this.shown().length);
  protected readonly overflowTitle = computed(() =>
    this.capabilities()
      .slice(MAX_ICONS)
      .map((c) => c.title)
      .join(', '),
  );

  protected chipVars(accent: string) {
    return accentVars(accent);
  }
}
