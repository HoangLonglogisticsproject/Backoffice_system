import { Role } from './access-scope';

/**
 * Organization model. Deliberately free of any tenant's business vocabulary —
 * a department here is a row of data, never a name baked into the code.
 */

/** Key of a capability registered in the capability registry. */
export type CapabilityKey = string;

/**
 * A key into the theme's accent scale — NOT a colour.
 *
 * Deliberately an open string. It used to be a closed union of seven hues,
 * which meant a customer who wanted `copper` had to edit a type in the domain
 * model to make a visual decision. What the key resolves to is decided by
 * `--c-<key>` / `--c-<key>-soft` in the theme, and by nothing here.
 *
 * The cost is that a typo is not caught at compile time. That is the right
 * trade: an unknown key falls back to the neutral accent rather than failing,
 * and the alternative locked visual vocabulary into business types.
 */
export type AccentKey = string;

/** Who is acting, and where they sit in the organization. */
export interface UserContext {
  userId: string;
  name: string;
  title: string;
  role: Role;
  /** undefined for SUPERADMIN — they sit above departments. Required otherwise. */
  departmentId?: string;
  avatarUrl?: string;
}

export interface Department {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  accent: AccentKey;
  active: boolean;
  headId: string | null;
  memberCount: number;
  /** Configuration: which registered capabilities this department may use. */
  capabilities: CapabilityKey[];
}

/** A person inside a department, used for assignment and workload views. */
export interface Member {
  userId: string;
  departmentId: string;
  name: string;
  title: string;
  role: Role;
  avatarUrl?: string;
}
