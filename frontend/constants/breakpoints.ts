/**
 * The two widths the whole interface turns on.
 *
 * They exist in TypeScript because `Viewport` matches them with matchMedia, and
 * in SCSS because `styles/tokens/_mixins.scss` matches them with @media. Two
 * languages cannot share one literal, so this file is the stated source and the
 * mixins carry a pointer back to it — a drift between the two would silently
 * put the layout and the styling on different sides of a breakpoint.
 */
export const BREAKPOINT_MOBILE = 899;
export const BREAKPOINT_DESKTOP = 1279;
