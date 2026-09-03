import type { AccountStatus } from '../../../common/types/user-summary';

/**
 * A driver account as Driver Management sees it.
 *
 * ★ A PROJECTION OF `users`, NOT A TABLE OF ITS OWN. A driver is a user row
 * with `account_type = 'driver'` and nothing else; this type is what an
 * administrator's screen may know about one. Six fields, all of them already
 * public to the people who hold `user.write`. Nothing from `identities` beyond
 * the address's local part, and nothing at all from `sessions` or the
 * credential — there is no field here on which a secret could ever ride.
 */
export interface DriverAccount {
  id: string;
  displayName: string;
  /** The local part of the sign-in address. `null` when the account has no local identity. */
  username: string | null;
  accountType: 'driver';
  status: AccountStatus;
  createdAt: Date;
}
