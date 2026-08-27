import type { Database } from '../../../common/types/database.port';
import { ConflictError } from '../../../common/errors/domain.error';
import { AccountInvitationService } from './account-invitation.service';

/**
 * ⚠ V12 — THE ARCHIVE RACE, on the third inbound path.
 *
 * Approving an invitation provisions a person INTO a department, so it is a
 * membership-creating path exactly like `enroll` and `transfer`, and it carried
 * the same defect: it re-read the department with `findById`, which takes no
 * lock, while `DepartmentService.archive` reads it with `lockById`. Nothing
 * made the two contend, so an approval could commit a fresh active membership
 * into a unit that had just been archived.
 *
 * These assert the LOCK, because the archived-status check passed both before
 * and after the fix and therefore proves nothing on its own.
 *
 * A unit spec rather than an addition to `account-invitation.integration.spec`:
 * the integration suite is skipped unless `DATABASE_URL_TEST` is set, and this
 * assertion should run on every machine, in every CI job.
 */

const departmentRow = (over: Record<string, unknown> = {}) => ({
  id: 'dep-1',
  slug: 'sales',
  name: 'Sales',
  status: 'active',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...over,
});

const invitationRow = {
  id: 'inv-1',
  departmentId: 'dep-1',
  email: 'newcomer@hoanglonglti.com',
  status: 'pending',
  requestedBy: 'head-1',
  requestedAt: new Date('2026-08-01'),
  decidedBy: null,
  decidedAt: null,
  reason: null,
  createdUserId: null,
};

describe('AccountInvitationService.approve — the archived-department race (V12)', () => {
  const build = (departmentOver: Record<string, unknown> = {}) => {
    const tx = { query: jest.fn() };
    const db = {
      query: jest.fn(),
      transaction: jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx)),
    } as unknown as Database;

    const departments = {
      findById: jest.fn().mockResolvedValue(departmentRow(departmentOver)),
      lockById: jest.fn().mockResolvedValue(departmentRow(departmentOver)),
    };
    const invitations = {
      lockPending: jest.fn().mockResolvedValue(invitationRow),
      decide: jest.fn().mockResolvedValue({ ...invitationRow, status: 'approved' }),
    };
    const assignments = {
      findActiveHeadOfDepartment: jest.fn().mockResolvedValue({ userId: 'head-1' }),
    };
    const identities = { subjectExists: jest.fn().mockResolvedValue(false) };
    const provisioning = {
      provision: jest.fn().mockResolvedValue({
        user: { id: 'user-1' },
        username: 'newcomer',
        temporaryPassword: 'generated',
      }),
    };

    const service = new AccountInvitationService(
      db,
      invitations as never,
      provisioning as never,
      identities as never,
      departments as never,
      assignments as never,
      { allowedEmailDomains: ['hoanglonglti.com'] } as never,
    );

    return { service, departments, provisioning, invitations, tx };
  };

  const approve = (service: AccountInvitationService) =>
    service.approve({ invitationId: 'inv-1', decidedBy: 'admin-1' });

  it('LOCKS the department it is about to provision into', async () => {
    const { service, departments, tx } = build();

    await approve(service);

    expect(departments.lockById).toHaveBeenCalledWith('dep-1', tx);
    // An unlocked read is the bug: it cannot contend with archive.
    expect(departments.findById).not.toHaveBeenCalled();
  });

  it('takes the lock BEFORE provisioning, not after', async () => {
    const order: string[] = [];
    const { service, departments, provisioning } = build();
    departments.lockById.mockImplementation(async () => {
      order.push('lock-department');
      return departmentRow();
    });
    provisioning.provision.mockImplementation(async () => {
      order.push('provision');
      return { user: { id: 'user-1' }, username: 'newcomer', temporaryPassword: 'generated' };
    });

    await approve(service);

    expect(order).toEqual(['lock-department', 'provision']);
  });

  /**
   * ★ THE LOSER OF THE RACE. Once archive commits and releases the row, the
   * status this transaction re-reads is the one archive wrote — so the approval
   * refuses instead of provisioning into a closed unit.
   */
  it('refuses once the unit it re-reads under the lock is archived', async () => {
    const { service, provisioning, invitations } = build({ status: 'archived' });

    await expect(approve(service)).rejects.toBeInstanceOf(ConflictError);

    // No partial data: no account, and the invitation stays awaiting a decision.
    expect(provisioning.provision).not.toHaveBeenCalled();
    expect(invitations.decide).not.toHaveBeenCalled();
  });

  it('locks on the transaction the approval already opened', async () => {
    const { service, departments, tx } = build();

    await approve(service);

    // ★ A lock taken on a different connection would release immediately and
    // contend with nobody — the whole fix depends on sharing this transaction.
    const [, executor] = departments.lockById.mock.calls[0]!;
    expect(executor).toBe(tx);
  });
});
