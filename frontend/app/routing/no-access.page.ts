import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '@bo/components';

@Component({
  selector: 'bo-no-access',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <bo-empty-state
      icon="shield"
      message="Bạn không có quyền truy cập khu vực này. Nếu cần, hãy gửi yêu cầu tới quản lý của bạn."
    >
      <a class="btn btn--sm" routerLink="/">Về workspace của tôi</a>
    </bo-empty-state>
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      min-height: 60vh;
    }
  `,
})
export class NoAccessPage {}
