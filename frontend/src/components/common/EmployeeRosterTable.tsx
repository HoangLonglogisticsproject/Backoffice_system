import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDate } from '@/utils/format/datetime';
import type { EmployeeRole, EmployeeRosterRow, MembershipStatus } from '@/types/organization';

/**
 * The employee roster, drawn once for both audiences.
 *
 * ★ ONE TABLE, ONE COLUMN OF DIFFERENCE. A head reads their own unit, so naming
 * it in every row would be the same word repeated down the page; a global
 * administrator reads every unit, so without it the rows are ambiguous. That is
 * the ONLY thing the two views disagree about — `showDepartment` — and putting
 * it behind a flag is what stops the two tables drifting into two definitions of
 * what an employee is.
 *
 * ★ NO AUTHORIZATION AND NO FILTERING HERE. Which rows exist was decided by the
 * server; this renders what it sent. A component that dropped a row would be
 * deciding, in the browser, something the guard already answered.
 *
 * ★ NOTHING IS DERIVED THAT THE SERVER DID NOT SEND. `role`, `membershipStatus`
 * and `joinedAt` are read straight off the row. The only translation is from
 * the contract's enum to the words the business uses for it.
 */
export function EmployeeRosterTable({
  rows,
  showDepartment = false,
}: Readonly<{ rows: EmployeeRosterRow[]; showDepartment?: boolean }>) {
  const { t, language } = useLanguage();

  return (
    <Table>
      <TableHeader className="bg-gray-50/50">
        <TableRow>
          <TableHead className="w-[50px] text-center font-semibold text-gray-600">
            {t('colIndex')}
          </TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colEmployee')}</TableHead>
          {showDepartment && (
            <TableHead className="font-semibold text-gray-600">{t('colDepartment')}</TableHead>
          )}
          <TableHead className="font-semibold text-gray-600">{t('colPosition')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colJoinedAt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          // Keyed by the MEMBERSHIP, not the person: one person can hold several
          // rows here over time, and keying by `user.id` would collapse a
          // transfer's two lines of history into one.
          <TableRow key={row.id} className="hover:bg-blue-50/30 transition-colors">
            <TableCell className="text-center text-gray-500 font-medium">{index + 1}</TableCell>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8 ring-1 ring-gray-100">
                  <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                    {row.user.displayName.trim().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {/*
                  ★ LINKED BY `user.id`, NEVER BY THE MEMBERSHIP. Detail is about
                  the PERSON, who may hold several periods; a membership id would
                  open one period and hide the rest. The row already carries the
                  person's id, so no new identifier was introduced for this.
                */}
                <Link
                  to={`/organization/employee/${row.user.id}`}
                  className="font-medium text-gray-900 hover:text-blue-700 hover:underline"
                >
                  {row.user.displayName}
                </Link>
              </div>
            </TableCell>
            {showDepartment && (
              <TableCell className="text-gray-600">{row.department.name}</TableCell>
            )}
            <TableCell className="text-gray-600">
              <PositionLabel role={row.role} />
            </TableCell>
            <TableCell>
              <MembershipStatusBadge status={row.membershipStatus} />
            </TableCell>
            <TableCell className="text-gray-600">{formatDate(row.joinedAt, language)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The business word for a position the authorization model derives.
 *
 * ⚠ THE SERVER DECIDES THE ROLE, THIS ONLY NAMES IT. `MEMBER` arrives because
 * no active DEPARTMENT_HEAD assignment was found — it is not a stored value, and
 * nothing here should ever try to work it out from a department, a date or an
 * account state.
 */
function PositionLabel({ role }: Readonly<{ role: EmployeeRole }>) {
  const { t } = useLanguage();
  return <>{role === 'DEPARTMENT_HEAD' ? t('roleDepartmentHead') : t('roleMember')}</>;
}

/**
 * The MEMBERSHIP's status — is this person still in this unit.
 *
 * ⚠ NOT `accountStatus`. Whether the account may sign in is a different column
 * answering a different question, and the roster deliberately does not show it:
 * a single "Trạng thái" that sometimes meant one and sometimes the other is the
 * confusion this separation exists to prevent.
 */
export function MembershipStatusBadge({ status }: Readonly<{ status: MembershipStatus }>) {
  const { t } = useLanguage();
  const styles =
    status === 'active'
      ? 'bg-green-50 text-green-700 ring-green-600/20'
      : 'bg-gray-50 text-gray-600 ring-gray-500/10';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {status === 'active' ? t('statusActive') : t('statusInactive')}
    </span>
  );
}
