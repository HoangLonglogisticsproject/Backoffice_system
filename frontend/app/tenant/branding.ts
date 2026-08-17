import { Branding } from '@bo/services';

/**
 * THG's identity. Everything visual that says "THG" lives here — swap this
 * object (and the fixtures) and the same platform ships to another company.
 */
export const THG_BRANDING: Branding = {
  productName: 'THG Backoffice',
  monogram: 'THG',
  accent: 'blue',
  version: 'v2.6.1',
  copyright: '© 2024 THG Fulfill. All rights reserved.',
  // `theme` is deliberately empty. THG's colours now live in
  // app/theme/_palette.scss, resolved at build time with no runtime cost and
  // one owner. This field stays available for the case it was built for:
  // choosing a palette at RUNTIME, e.g. one deployment serving several brands.
};
