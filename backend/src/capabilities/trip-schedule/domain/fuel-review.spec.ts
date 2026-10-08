import { ACCOUNTING_ACTIONS, canMove, needsReason } from './fuel-review';

describe('the fuel review state machine', () => {
  it('starts only as submitted', () => {
    expect(canMove(null, 'submitted')).toBe(true);
    for (const to of ['needs_info', 'approved', 'paid', 'rejected'] as const) expect(canMove(null, to)).toBe(false);
  });

  it('★ is approved before it is paid — never submitted straight to paid', () => {
    expect(canMove('submitted', 'paid')).toBe(false);
    expect(canMove('needs_info', 'paid')).toBe(false);
    expect(canMove('approved', 'paid')).toBe(true);
  });

  it('goes back to the driver and returns, or is refused', () => {
    expect(canMove('submitted', 'needs_info')).toBe(true);
    expect(canMove('needs_info', 'submitted')).toBe(true);
    expect(canMove('needs_info', 'rejected')).toBe(true);
    expect(canMove('needs_info', 'approved')).toBe(false);
  });

  it('★ ends at paid or rejected', () => {
    for (const to of ['submitted', 'needs_info', 'approved', 'paid', 'rejected'] as const) {
      expect(canMove('paid', to)).toBe(false);
      expect(canMove('rejected', to)).toBe(false);
    }
  });

  it('asks a reason for asking and refusing only, and names four Accounting decisions', () => {
    expect(['needs_info', 'rejected'].every((s) => needsReason(s as 'needs_info'))).toBe(true);
    expect(needsReason('approved') || needsReason('paid') || needsReason('submitted')).toBe(false);
    expect(ACCOUNTING_ACTIONS).toEqual({ 'request-info': 'needs_info', approve: 'approved', reject: 'rejected', 'mark-paid': 'paid' });
  });
});
