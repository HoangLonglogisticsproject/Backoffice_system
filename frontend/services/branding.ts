import { InjectionToken } from '@angular/core';
import { AccentKey } from '@bo/types';

/**
 * Everything tenant-specific about the chrome. The platform reads this; it
 * never hard-codes a company name, logo or palette. Swapping tenants is a
 * change to one provider in the app's composition root.
 */
export interface Branding {
  productName: string;
  /** Short mark shown in the sidebar logo tile. */
  monogram: string;
  accent: AccentKey;
  version: string;
  copyright: string;
  /**
   * CSS custom properties applied to :root at bootstrap.
   *
   * For choosing a palette at RUNTIME only — one deployment serving several
   * brands, or a theme that arrives from an API. A customer whose look is fixed
   * at build time should use its own `theme/` stylesheet instead: same result,
   * no runtime cost, and one owner for the values.
   */
  theme?: Record<string, string>;
}

export const BRANDING = new InjectionToken<Branding>('BRANDING');
