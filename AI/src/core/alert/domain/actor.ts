/**
 * Who moved an alert.
 *
 * Two kinds and no third. A `user` is a backend user id the backend vouched
 * for through a signed trusted context; the AI never looks the id up. The
 * `system` is the engine itself — a verified-clear resolution — and it has no
 * id, because inventing a "system user" row would be a lie the audit trail
 * then has to carry forever. The history table's CHECK pins the pairing.
 */
export type Actor = { readonly type: 'user'; readonly id: string } | { readonly type: 'system' };

export type ActorType = Actor['type'];

export const SYSTEM_ACTOR: Actor = { type: 'system' };

/** The two columns the history row stores. Throws on a user actor with no id. */
export function actorColumns(actor: Actor): { actorType: ActorType; actorId: string | null } {
  if (actor.type === 'system') return { actorType: 'system', actorId: null };

  if (typeof actor.id !== 'string' || actor.id.trim().length === 0) {
    throw new Error('A user actor must carry the user id the backend vouched for.');
  }
  return { actorType: 'user', actorId: actor.id };
}
