import { HISTORICAL_ENTRY_REASON, initialLifecycle } from './trip-status-history';

describe('initialLifecycle — the client says why, the server decides how a trip starts', () => {
  const none = { crewSupplied: false };

  it('★ opens a booking pending, or on another status the board may set', () => {
    expect(initialLifecycle('operational', none)).toEqual({ ok: true, status: 'pending', closed: false, reason: null });
    expect(initialLifecycle('operational', { ...none, status: 'executing' })).toMatchObject({ status: 'executing' });
  });

  it('★ never opens a booking on the retired `confirmed` — "Đã xác nhận" is `finished` now', () => {
    expect(initialLifecycle('operational', { ...none, status: 'confirmed' })).toEqual({
      ok: false,
      refusal: 'RETIRED_STATUS',
    });
  });

  it('★ never opens a booking finished — only approval reaches that', () => {
    expect(initialLifecycle('operational', { ...none, status: 'finished' })).toEqual({
      ok: false,
      refusal: 'COMPLETION_ONLY',
    });
  });

  it('★ records a run that ended as finished, closed and marked — whatever the client would have liked', () => {
    expect(initialLifecycle('historical', none)).toEqual({
      ok: true,
      status: 'finished',
      closed: true,
      reason: HISTORICAL_ENTRY_REASON,
    });
    expect(initialLifecycle('historical', { crewSupplied: true })).toMatchObject({ closed: true });
  });

  it('★ refuses a status named beside a historical entry — it is not the client’s to set', () => {
    for (const status of ['pending', 'executing', 'finished'] as const) {
      expect(initialLifecycle('historical', { ...none, status })).toEqual({ ok: false, refusal: 'STATUS_SET_BY_ENTRY' });
    }
  });

  it('refuses a crew on a booking — dispatch crews it once it exists, and tells the driver', () => {
    expect(initialLifecycle('operational', { crewSupplied: true })).toEqual({ ok: false, refusal: 'CREW_AFTER_BOOKING' });
  });

  it('books for an in-process caller that names no intent', () => {
    expect(initialLifecycle(undefined, none)).toMatchObject({ status: 'pending', closed: false });
  });
});
