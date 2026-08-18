/**
 * The display name derived from a login subject.
 *
 * `hieu.truong@example.com` → `hieu.truong`
 *
 * DERIVED, never stored. There is no username column, no username credential
 * and no username login path: a second stored copy of the local part is a
 * second thing that can disagree with the email, and a second login path is a
 * second thing to secure. Because it is computed from the subject, it cannot
 * drift — and because the subject is immutable after provisioning, neither can
 * this.
 *
 * `lastIndexOf` rather than `indexOf`, and that is not pedantry: a quoted local
 * part may legally contain `@`, while a domain never can, so cutting at the
 * last one is right in every case and cutting at the first is silently wrong in
 * a rare one.
 */
export function localPartOf(subject: string): string {
  const at = subject.lastIndexOf('@');
  return at === -1 ? subject : subject.slice(0, at);
}
