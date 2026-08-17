/**
 * What the navigation surface needs in order to draw itself — and nothing else.
 *
 * Nothing from any customer's product vocabulary appears below — no org units,
 * no permission scopes, no feature keys. Those words belong to one product;
 * this file has to survive every product.
 *
 * The application maps its own concepts onto these shapes. That mapping is the
 * seam that lets the navigation ship unchanged to the next project.
 */

/** A single destination. */
export interface NavItem {
  label: string;
  icon: string;
  /** Router link. The navigation never builds a URL, it only renders one. */
  link: string;
  /** Small count on the right. Omit for none. */
  badge?: number;
}

/**
 * A destination that owns a collapsible set of destinations beneath it.
 *
 * `id` is the stable key the caller uses to remember whether this group is
 * open. It must survive a re-render; anything unique and stable will do.
 */
export interface NavGroup {
  id: string;
  label: string;
  icon: string;
  link: string;
  /**
   * Key into the theme's accent scale — `--c-<accent>`. A key, never a colour:
   * what it resolves to is the theme's business, not the navigation's.
   */
  accent?: string;
  children: NavItem[];
  /** Open on first render unless the user has said otherwise. */
  expandedByDefault: boolean;
}

/**
 * The whole navigation, in render order: fixed destinations, then the groups,
 * then the ones that sit at the bottom.
 *
 * Section headings are strings rather than constants because they are the
 * customer's words — "Departments", "Branches", "Studios" — and the navigation
 * has no opinion about which.
 */
export interface NavigationModel {
  primary: NavItem[];
  groups: NavGroup[];
  /** Heading above `groups`. Empty hides the heading. */
  groupsLabel: string;
  secondary: NavItem[];
  /** Heading above `secondary`. Empty hides the heading. */
  secondaryLabel: string;
}

/** Identity shown at the top and in the footer. */
export interface NavBrand {
  name: string;
  /** Short mark for the logo tile — two or three characters. */
  monogram: string;
  /** Accent key, same contract as `NavGroup.accent`. */
  accent?: string;
  version?: string;
  copyright?: string;
}

/** Which groups the user has explicitly opened or closed, by `NavGroup.id`. */
export type NavExpansion = Readonly<Record<string, boolean>>;
