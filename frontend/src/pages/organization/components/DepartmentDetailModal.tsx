import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { EmployeeRosterTable } from '@/components/common/EmployeeRosterTable';
import { StatusPill } from '@/components/common/StatusPill';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useDepartmentMutations } from '@/hooks/organization/useDepartmentAdmin';
import { notifyApiError, notifySuccess } from '@/utils/toast';
import type { Department, EmployeeRosterRow } from '@/types/organization';
import type { TranslationKey } from '@/types/translate';
import { AddEmployeeModal } from './AddEmployeeModal';
import { FUNCTION_LABEL } from './DepartmentFormModal';

interface DepartmentDetailModalProps {
  department: Department;
  /** The whole active roster; this dialog picks its own unit's rows out of it. */
  roster: EmployeeRosterRow[];
  onClose: () => void;
  /**
   * Something changed on the server OUTSIDE this dialog's own mutations —
   * the add-employee dialog, or a replacement that failed half-way — so the
   * page re-reads. The mutations here invalidate the directory themselves.
   */
  onChanged: () => void;
}

/**
 * One unit: what it is, who leads it, who is in it — and the three
 * administrative acts a global caller may perform on it.
 *
 * ★ EVERY WRITE IS A ROUTE THE SERVER ALREADY HAS, called for what it is:
 *
 *   appoint / replace / revoke the head   POST / DELETE /departments/:id/head
 *                                         (`role.assign`); replacing is the
 *                                         two calls in order, because the
 *                                         unique index refuses two active heads
 *   move somebody in                      POST /departments/:id/members
 *                                         (`unit.member.write`) — a TRANSFER:
 *                                         their current membership ends
 *   add a new employee here               the existing AddEmployeeModal
 *
 * There is no "remove from the unit": an active person always belongs
 * somewhere, so leaving one unit IS being moved into another — done from
 * that unit's dialog. Nothing here reads or writes a membership to fake a
 * head; the head is what `role_assignments` says, read off the roster.
 */
export function DepartmentDetailModal({
  department,
  roster,
  onClose,
  onChanged,
}: Readonly<DepartmentDetailModalProps>) {
  const { t } = useLanguage();
  const { can } = useSession();
  const { transfer, assignHead, revokeHead } = useDepartmentMutations();

  const members = roster.filter((row) => row.department.id === department.id);
  const head = members.find((row) => row.role === 'DEPARTMENT_HEAD') ?? null;
  const elsewhere = roster.filter(
    (row) => row.department.id !== department.id && row.accountStatus === 'active',
  );

  const [headPick, setHeadPick] = useState<string | null>(null);
  const [transferPick, setTransferPick] = useState<string | null>(null);
  const [addingEmployee, setAddingEmployee] = useState(false);

  const mayAppoint = can('role.assign');
  const mayTransfer = can('unit.member.write');
  const mayCreate = can('user.write');
  const headBusy = assignHead.isPending || revokeHead.isPending;
  /** Appointing into an empty seat and replacing a sitting head are the same act with a different verb. */
  const appointLabel: TranslationKey = head ? 'replaceHead' : 'assignHead';

  /** Appoint `headPick`; when somebody already holds it, revoke first (contract §15b). */
  const appoint = async () => {
    if (!headPick || headBusy) return;
    try {
      if (head) await revokeHead.mutateAsync({ departmentId: department.id });
      await assignHead.mutateAsync({ departmentId: department.id, userId: headPick });
      notifySuccess('headAssigned');
      setHeadPick(null);
    } catch (error) {
      // A 409 names the invariant (two heads, not a member); shown as the
      // server said it. The revoke may already have landed, so re-read.
      notifyApiError(error, 'headActionFailed');
      onChanged();
    }
  };

  const revoke = async () => {
    if (headBusy) return;
    try {
      await revokeHead.mutateAsync({ departmentId: department.id });
      notifySuccess('headRevoked');
    } catch (error) {
      notifyApiError(error, 'headActionFailed');
    }
  };

  const moveIn = async () => {
    if (!transferPick || transfer.isPending) return;
    try {
      await transfer.mutateAsync({ departmentId: department.id, userId: transferPick });
      notifySuccess('memberTransferred');
      setTransferPick(null);
    } catch (error) {
      notifyApiError(error, 'transferFailed');
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={department.name} className="max-w-3xl">
      <div className="space-y-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">{t('colSlug')}</dt>
            <dd className="font-mono text-gray-900">{department.slug}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('colFunction')}</dt>
            <dd className="text-gray-900">
              {department.function ? t(FUNCTION_LABEL[department.function]) : t('functionNone')}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('colStatus')}</dt>
            <dd>
              <StatusPill tone={department.status === 'active' ? 'green' : 'gray'}>
                {t(department.status === 'active' ? 'departmentActive' : 'statusArchived')}
              </StatusPill>
            </dd>
          </div>
        </dl>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">{t('headSection')}</h3>
          <p className="text-sm text-gray-700">{head ? head.user.displayName : t('noHead')}</p>
          {mayAppoint && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="department-head-pick" className="sr-only">
                {t('headCandidate')}
              </label>
              <SearchableSelect
                id="department-head-pick"
                items={members
                  .filter((row) => row.user.id !== head?.user.id)
                  .map((row) => ({ value: row.user.id, label: row.user.displayName }))}
                value={headPick}
                onValueChange={setHeadPick}
                placeholder={t('pickMember')}
                emptyText={t('noMembersToPick')}
                disabled={headBusy}
                className="sm:w-72"
              />
              <Button
                type="button"
                onClick={() => void appoint()}
                disabled={!headPick || headBusy}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {headBusy ? t('saving') : t(appointLabel)}
              </Button>
              {head && (
                <Button type="button" variant="outline" onClick={() => void revoke()} disabled={headBusy}>
                  {t('revokeHead')}
                </Button>
              )}
            </div>
          )}
          {mayAppoint && <p className="text-xs text-gray-500">{t('headMustBeMember')}</p>}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              {t('membersSection')} ({members.length})
            </h3>
            {mayCreate && (
              <Button type="button" variant="outline" size="sm" onClick={() => setAddingEmployee(true)}>
                {t('addEmployee')}
              </Button>
            )}
          </div>
          {members.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <EmployeeRosterTable rows={members} />
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('emptyMembers')}</p>
          )}
          {mayTransfer && (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor="department-transfer-pick" className="sr-only">
                  {t('transferCandidate')}
                </label>
                <SearchableSelect
                  id="department-transfer-pick"
                  items={elsewhere.map((row) => ({
                    value: row.user.id,
                    label: `${row.user.displayName} — ${row.department.name}`,
                  }))}
                  value={transferPick}
                  onValueChange={setTransferPick}
                  placeholder={t('pickEmployee')}
                  emptyText={t('noEmployeesToPick')}
                  disabled={transfer.isPending}
                  className="sm:w-72"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void moveIn()}
                  disabled={!transferPick || transfer.isPending}
                >
                  {transfer.isPending ? t('saving') : t('transferIn')}
                </Button>
              </div>
              <p className="text-xs text-gray-500">{t('transferInHint')}</p>
            </div>
          )}
        </section>
      </div>

      {addingEmployee && (
        <AddEmployeeModal
          isOpen
          departmentId={department.id}
          initialAccountType="employee"
          lockAccountType
          onClose={() => setAddingEmployee(false)}
          onCreated={() => {
            setAddingEmployee(false);
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}
