import { Directive, booleanAttribute, input } from '@angular/core';

export type ButtonVariant = 'default' | 'primary' | 'soft' | 'ghost';
export type ButtonSize = 'md' | 'sm';

/**
 * Button.
 *
 *   <button bo-button variant="primary">Save</button>
 *   <a bo-button variant="ghost" routerLink="/x">Details</a>
 *
 * A directive on the native element, not a wrapping component, and that is the
 * whole design. `<button>` already ships the type, the disabled semantics, the
 * form participation, the focus behaviour and the screen-reader role; wrapping
 * it means re-implementing all of that and getting some of it wrong. It also
 * adds no DOM node, so nothing shifts inside a flex or grid parent.
 *
 * Visual language is not decided here — every value lives in _button.scss and
 * every one of those reads a token. A customer restyles buttons by overriding
 * tokens, never by forking this file.
 */
@Directive({
  selector: 'button[bo-button], a[bo-button]',
  host: {
    class: 'btn',
    '[class.btn--primary]': "variant() === 'primary'",
    '[class.btn--soft]': "variant() === 'soft'",
    '[class.btn--ghost]': "variant() === 'ghost'",
    '[class.btn--sm]': "size() === 'sm'",
    '[class.btn--block]': 'block()',
  },
})
export class Button {
  readonly variant = input<ButtonVariant>('default');
  readonly size = input<ButtonSize>('md');
  /**
   * Fills the width of its container — for panel footers and mobile actions.
   * `booleanAttribute` so the template can write `block` on its own rather than
   * `[block]="true"`, matching how native boolean attributes read.
   */
  readonly block = input(false, { transform: booleanAttribute });
}
