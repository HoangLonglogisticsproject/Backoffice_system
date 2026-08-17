import { Directive } from '@angular/core';

/**
 * Native select.
 *
 *   <select boSelect [(ngModel)]="unitId"> … </select>
 *
 * Native on purpose: a custom listbox costs a keyboard implementation, a focus
 * trap, virtual scrolling and a screen-reader contract, and on a phone it loses
 * the platform picker that users already know. Build one when a screen actually
 * needs multi-select or option search — not before.
 *
 * ponytail: chevron is a background image, so no wrapper element is needed to
 * position an icon.
 */
@Directive({
  selector: 'select[boSelect]',
  host: { class: 'select' },
})
export class Select {}
