import { actorColumns, SYSTEM_ACTOR, type Actor } from './actor';

describe('actor', () => {
  it('the system has no id — and no fake user is invented for it', () => {
    expect(actorColumns(SYSTEM_ACTOR)).toEqual({ actorType: 'system', actorId: null });
  });

  it('a user carries the id the backend vouched for', () => {
    expect(actorColumns({ type: 'user', id: 'u-1' })).toEqual({ actorType: 'user', actorId: 'u-1' });
  });

  it('a user without an id is refused, not stored as a system', () => {
    expect(() => actorColumns({ type: 'user', id: '' })).toThrow(/user actor must carry/);
    expect(() => actorColumns({ type: 'user', id: '   ' })).toThrow(/user actor must carry/);
    expect(() => actorColumns({ type: 'user' } as unknown as Actor)).toThrow(/user actor must carry/);
  });
});
