import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { SessionStore } from '@bo/store';
import { Avatar, Icon } from '@bo/components';
import { PersonaSwitcher } from './persona-switcher';
import { PageTitle } from './page-title';

const ROLE_LABEL: Record<string, string> = {
  SUPERADMIN: 'Toàn tổ chức',
  DEPARTMENT_HEAD: 'Trưởng phòng',
  MEMBER: 'Nhân viên',
};

@Component({
  selector: 'bo-topbar',
  imports: [Avatar, Icon, PersonaSwitcher],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showMenu()) {
      <button class="btn btn--icon" type="button" aria-label="Mở điều hướng" (click)="menu.emit()">
        <bo-icon name="menu" [size]="18" />
      </button>
    }

    <h2 class="title">{{ pageTitle.title() }}</h2>

    <label class="search">
      <bo-icon name="search" [size]="14" />
      <input type="search" placeholder="Tìm kiếm nhanh (Ctrl + K)" [attr.aria-label]="'Tìm kiếm'" />
    </label>

    <div class="actions">
      <button class="btn btn--icon" type="button" aria-label="Thông báo">
        <bo-icon name="bell" [size]="18" />
        <span class="dot">8</span>
      </button>
      <button class="btn btn--icon" type="button" aria-label="Trợ giúp">
        <bo-icon name="help-circle" [size]="18" />
      </button>
      <button class="btn btn--primary create" type="button" aria-label="Tạo mới">
        <bo-icon name="plus" [size]="14" />
        <span>Tạo mới</span>
      </button>

      @if (session.canSwitchPersona()) {
        <bo-persona-switcher />
      }

      @if (session.context(); as user) {
        <div class="user">
          <bo-avatar [name]="user.name" [src]="user.avatarUrl" [size]="32" />
          <div class="identity">
            <strong>{{ user.name }}</strong>
            <span>{{ user.title || roleLabel() }}</span>
          </div>
        </div>
      }
    </div>
  `,
  styleUrl: './topbar.scss',
})
export class Topbar {
  readonly showMenu = input(false);
  readonly menu = output<void>();

  protected readonly session = inject(SessionStore);
  protected readonly pageTitle = inject(PageTitle);
  protected readonly roleLabel = computed(() => ROLE_LABEL[this.session.role()] ?? '');
}
