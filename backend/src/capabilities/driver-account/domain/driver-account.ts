import type { AccountStatus, UserSummary } from '../../../common/types/user-summary';

/**
 * A driver account, as the roster reads it.
 *
 * ★ WHY THIS EXISTS AT ALL. A driver account was invisible. It has no
 * department membership — deliberately, see `DriverAccountService` — so it
 * never appears in `GET /memberships`, which is a list of MEMBERSHIPS and not
 * of people. The only other place a driver was reachable is the assignment
 * dropdown, which answers "who may I put on this trip" and therefore shows live
 * accounts and nothing else. Somebody who had just created a driver had no
 * screen that could confirm it.
 *
 * ★ IT IS NOT A SECOND EMPLOYEE ROSTER, and it must not become one. There is no
 * department here, no role, no membership status and no join that could produce
 * them — a driver has none of those, and a table that showed the columns empty
 * would be inviting somebody to fill them in.
 *
 * ⚠ AND IT DECIDES NOTHING. Disabling an account is `PATCH /users/:id/status`,
 * which already exists and already carries the whole lifecycle (the membership
 * end, the role revocation). This shape is what a screen reads, never how it
 * writes.
 */
export interface DriverAccountRow {
  /** `users.id` — the identity every other resource references. */
  user: UserSummary;

  /**
   * What they type to sign in: the local part of their email.
   *
   * ★ HERE, THOUGH `UserSummary` DELIBERATELY OMITS IT. That type leaves the
   * username out because it costs a join and exposes half an email address, and
   * says a screen that genuinely needs it may add it. This is that screen: two
   * drivers can share a display name, and the username is the only column that
   * answers "is this the account I just created" — which is the entire question
   * this list was added to answer. It is safe here for a reason that does not
   * generalise: the route is `user.write`, held only by a global administrator,
   * who was shown this exact string when the account was created.
   *
   * `null` for an account with no local identity — impossible through
   * provisioning, and left representable rather than asserted away.
   */
  username: string | null;

  /**
   * `users.status`. NOT a membership status — a driver has no membership, so
   * there is no second status here to confuse it with.
   */
  accountStatus: AccountStatus;

  createdAt: Date;
}
