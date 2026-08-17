import { Directive, input } from '@angular/core';
import { ButtonSize } from '../button/button';

/**
 * Square, borderless button holding a single icon.
 *
 *   <button bo-icon-button aria-label="Notifications"><bo-icon name="bell" /></button>
 *
 * Separate from `bo-button` because it is a different control, not a variant:
 * it is square rather than text-width, and it has no visible label — which is
 * why an `aria-label` is not optional here. Keeping it apart makes that
 * requirement obvious at the call site instead of hiding it in a modifier.
 *
 * Shares the button stylesheet: `.btn.btn--icon`, one source of truth.
 */
@Directive({
  selector: 'button[bo-icon-button], a[bo-icon-button]',
  host: {
    class: 'btn btn--icon',
    '[class.btn--sm]': "size() === 'sm'",
  },
})
export class IconButton {
  readonly size = input<ButtonSize>('md');
}
