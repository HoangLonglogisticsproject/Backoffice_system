/**
 * The canonical way this API names a person.
 *
 * Every read resource that refers to somebody carries a UUID, and a UUID cannot
 * be shown to anyone. This is the one shape that turns it into something a
 * screen can print, and it is deliberately the SMALLEST such shape.
 *
 * ★ IT CARRIES NO AUTHORIZATION OF ITS OWN. A `UserSummary` only ever rides
 * inside a resource whose authorization has already been decided, so a name is
 * visible exactly when the row referencing it is. That is the whole reason this
 * is a projection rather than a `GET /users/:id`: a bare user id belongs to no
 * department from the permission model's point of view, so an endpoint that
 * resolved one would have to invent an authorization rule that either leaks
 * every name in the organization or re-decides, in a second place, what the
 * owning resource already decided.
 *
 * WHY `displayName` AND NOTHING ELSE:
 *
 *   `username`  is not stored. It is derived from `identities.subject`, which
 *               IS the email — so including it costs a second join AND exposes
 *               the local part of somebody's email address.
 *   `email`     is not a display name and must never be substituted for one.
 *   `status`    a member list already carries the MEMBERSHIP status, and an
 *               active membership implies an active user.
 *
 * Any of them can be added later against a real screen that needs them. None of
 * them can be un-shipped once a client depends on it, which is why the default
 * is to leave them out.
 */
export interface UserSummary {
  id: string;
  /** Never empty: `users.display_name` is NOT NULL with a non-blank CHECK. */
  displayName: string;
}

/**
 * `users.status` — whether the BACKOFFICE ACCOUNT may operate.
 *
 * ⚠ NOT whether somebody still works here. That is the MEMBERSHIP's status, and
 * the two are different columns answering different questions:
 *
 *   accountStatus     `users.status`                    active | disabled
 *   membershipStatus  `department_memberships.status`   active | ended
 *
 * They move together during offboarding — `AccountLifecycleService.disable`
 * writes both in one transaction — but nothing in the schema ties them, and the
 * combination `disabled` + `active` is representable on purpose. Deriving
 * either from the other would invent a rule the database does not hold, so no
 * read model here does.
 */
export type AccountStatus = 'active' | 'disabled';
