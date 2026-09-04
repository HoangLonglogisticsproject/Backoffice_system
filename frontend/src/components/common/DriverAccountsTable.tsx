import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
import type { DriverAccountRow } from '@/api/driverAccounts';
import type { AccountStatus } from '@/types/organization';

/**
 * The driver roster.
 *
 * ★ A SEPARATE TABLE FROM `EmployeeRosterTable`, AND THE MISSING COLUMNS ARE THE
 * WHOLE REASON. That table shows a department, a position and a membership
 * status because each of its rows IS a membership. A driver has none of the
 * three — not blank ones, none — so reusing it would have meant three columns
 * that are permanently empty, which is an invitation to fill them in.
 *
 * ★ WHAT IT SHOWS INSTEAD IS WHAT A DRIVER ACCOUNT ACTUALLY HAS: a name, the
 * username they sign in with, whether the account may operate, and when it was
 * made. The username is here because it is the only column that separates two
 * drivers with the same display name — and it is the string somebody was shown
 * when they created the account, which is the question this screen exists to
 * answer.
 *
 * ★ NO AUTHORIZATION AND NO FILTERING HERE. Which rows exist was decided by the
 * server; this renders what it sent. `onDisable` is drawn when the caller passes
 * one, and the server re-decides the write regardless of what was drawn.
 */
export function DriverAccountsTable({
  rows,
  onDisable,
  onEnable,
}: Readonly<{
  rows: DriverAccountRow[];
  /** Omitted for a caller who may not act. The row still renders. */
  onDisable?: (row: DriverAccountRow) => void;
  onEnable?: (row: DriverAccountRow) => void;
}>) {
  const { t, language } = useLanguage();
  const actionable = Boolean(onDisable ?? onEnable);

  return (
    <Table>
      <TableHeader className="bg-gray-50/50">
        <TableRow>
          <TableHead className="w-[50px] text-center font-semibold text-gray-600">
            {t('colIndex')}
          </TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colDriver')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colUsername')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
          <TableHead className="font-semibold text-gray-600">{t('colCreatedAt')}</TableHead>
          {actionable && (
            <TableHead className="font-semibold text-gray-600">{t('colActions')}</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          // Keyed by the PERSON, and here that is safe in a way it is not on the
          // employee roster: a driver has one account and no periods, so there
          // is no second row for the same id to collide with.
          <TableRow key={row.user.id} className="transition-colors hover:bg-blue-50/30">
            <TableCell className="text-center font-medium text-gray-500">{index + 1}</TableCell>
            <TableCell>
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8 ring-1 ring-gray-100">
                  <AvatarFallback className="bg-amber-100 text-xs font-semibold text-amber-700">
                    {row.user.displayName.trim().charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {/*
                  ★ THE SAME DETAIL PAGE AS AN EMPLOYEE, keyed by `user.id`. It is
                  one person either way; what differs is what the page finds
                  there — no department history, and the trips they have been
                  given instead.
                */}
                <Link
                  to={`/organization/employee/${row.user.id}`}
                  className="font-medium text-gray-900 hover:text-blue-700 hover:underline"
                >
                  {row.user.displayName}
                </Link>
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm text-gray-600">
              {/* Null only for an account with no local credential — which
                  provisioning cannot produce, and which this says out loud
                  rather than rendering as an empty cell. */}
              {row.username ?? <span className="text-gray-400">—</span>}
            </TableCell>
            <TableCell>
              <AccountStatusBadge status={row.accountStatus} />
            </TableCell>
            <TableCell className="text-gray-600">{formatDate(row.createdAt, language)}</TableCell>
            {actionable && (
              <TableCell>
                {/*
                  ★ ONE CONTROL PER ROW, AND WHICH ONE FOLLOWS THE STATUS. The
                  two operations are not mirror images — disabling also revokes
                  roles and kills sessions, re-enabling restores neither — but
                  from a row's point of view exactly one of them is ever the
                  sensible next step.

                  ★ AND RE-ENABLING IS A DRIVER-ONLY OPERATION, which is why it
                  can be offered here at all. On the employee roster it could
                  not: re-enabling one asks which department they return to, and
                  nobody has decided that. A driver belongs to no unit by design,
                  so there is no question to answer.
                */}
                {row.accountStatus === 'active'
                  ? onDisable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-red-700 hover:bg-red-50"
                        onClick={() => onDisable(row)}
                      >
                        {t('disableAccount')}
                      </Button>
                    )
                  : onEnable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-2 text-xs text-blue-700 hover:bg-blue-50"
                        onClick={() => onEnable(row)}
                      >
                        {t('enableAccount')}
                      </Button>
                    )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * `users.status` — may this account operate.
 *
 * ⚠ DELIBERATELY A DIFFERENT COMPONENT FROM `MembershipStatusBadge`, with
 * different words AND different colours. That badge says "Đang làm việc / Đã kết
 * thúc" about a period in a department; a driver has no period, so the only true
 * statement about them is whether the account is live. One shared badge would be
 * one edit away from showing a membership's vocabulary for an account state —
 * the confusion the whole two-status separation exists to prevent.
 *
 * ★ MOVED HERE FROM `EmployeeDetailPage`, WHERE IT WAS A PRIVATE COPY. The
 * driver roster needed the same badge, and a second definition beside the first
 * is how the two colour schemes for one column start to disagree.
 */
export function AccountStatusBadge({ status }: Readonly<{ status: AccountStatus }>) {
  const { t } = useLanguage();
  const styles =
    status === 'active'
      ? 'bg-blue-50 text-blue-700 ring-blue-600/20'
      : 'bg-red-50 text-red-700 ring-red-600/20';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {status === 'active' ? t('accountActive') : t('accountDisabled')}
    </span>
  );
}
