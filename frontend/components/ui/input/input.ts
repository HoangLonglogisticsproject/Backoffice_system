import { Directive } from '@angular/core';

/**
 * Text field.
 *
 *   <input boInput type="search" placeholder="Search" />
 *
 * A directive, so `type`, `placeholder`, `disabled`, `readonly`, form binding
 * and every input mode keep working without this file knowing they exist. The
 * alternative — a wrapping component with an input per native attribute — is a
 * list that is never finished and always one attribute behind.
 */
@Directive({
  // `select[boInput]` is deliberate, not a typo: a select may want the plain
  // field shape and the platform's own chevron, rather than the drawn one that
  // `boSelect` adds. Both are legitimate; the call site says which it means.
  selector: 'input[boInput], textarea[boInput], select[boInput]',
  host: { class: 'input' },
})
export class Input {}
