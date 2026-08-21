import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Filter, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CursorPagination } from '@/components/ui/pagination';
import { AddEmployeeModal } from './components/AddEmployeeModal';
import { useLanguage } from '@/contexts/LanguageContext';
import { formatDate } from '@/utils/format/datetime';
import { useCursorPages } from '@/hooks/useCursorPages';
import { fetchDepartmentMembers } from '@/api/membership';
import { useSession } from '@/contexts/SessionProvider';
import type { DepartmentMembershipWithUser, MembershipStatus } from '@/types/organization';

/**
 * Who is in a department.
 *
 * The layout is Phú's; the rows are real. `GET /departments/:id/members` returns
 * memberships with the member's name projected in (ADR-0001), so the table shows
 * people rather than UUIDs — while `userId` stays underneath as the identity the
 * app actually references.
 *
 * ⚠ AN ORDINARY MEMBER GETS 403 HERE, BY DESIGN (§6). That is a normal outcome
 * to render, not an error to report and not a reason to sign anybody out.
 *
 * FOUR COLUMNS PHÚ'S MOCK HAD ARE NOT HERE: employee code, job title, phone, and
 * branch. The backend stores none of them, and inventing them client-side would
 * put a second, fictional definition of an employee next to the real one. The
 * filters they fed are kept as UI, visibly disabled — see below.
 */
export default function EmployeeManagementPage() {
  const { departmentId } = useParams<{ departmentId: string }>();
  const { t, language } = useLanguage();
  const { state, can } = useSession();
  const [isAddOpen, setIsAddOpen] = useState(false);
  // Bumped after a create so the list re-reads. A full page reload would
  // throw away the session context and the language choice with it.
  const [refresh, setRefresh] = useState(0);

  const page = useCursorPages<DepartmentMembershipWithUser>(
    // Hooks cannot be called conditionally, so this runs before the guard
    // below. Rejecting is the honest answer: casting `undefined` to a string
    // would send a request to `/departments/undefined/members`, and returning
    // an empty page would dress a routing bug up as "this department has no
    // members".
    (request) =>
      departmentId
        ? fetchDepartmentMembers(departmentId, request)
        : Promise.reject(new Error('No department on the route.')),
    [departmentId, refresh],
  );

  if (!departmentId) return null;

  // ★ TWO WAYS IN, AND ONLY ONE OF THEM IS A PERMISSION.
  //
  // Direct creation is gated by `user.write`, which is GLOBAL-only. Raising an
  // invitation is not gated by any permission at all — the server uses
  // `HeadOfRouteDepartmentGuard`, which asks a RELATIONAL question: are you the
  // head of the department on this route? There is no permission key for that,
  // so `can()` cannot answer it and gating the button on `user.write` alone hid
  // the head's workflow entirely.
  //
  // The closest the session can say is role plus membership. It is exact in
  // practice: a head must be an active member of the department they lead
  // (invariant #6) and may hold only one active membership, so their
  // `departmentIds` is precisely the department they head.
  //
  // ⚠ STILL ONLY A RENDER HINT. The server re-decides on every request and
  // answers 403 regardless of what was drawn here (§13).
  const canCreateDirectly = can('user.write');
  const isHeadOfThisDepartment =
    state?.status === 'ready' &&
    state.authorization.role === 'DEPARTMENT_HEAD' &&
    state.authorization.departmentIds.includes(departmentId);
  const canAddSomeone = canCreateDirectly || isHeadOfThisDepartment;
  // Same button, same modal; the wording says which workflow it starts.
  const addLabel = canCreateDirectly ? t('addEmployee') : t('requestAccountTitle');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">{t('employeeList')}</h1>
        {canAddSomeone && (
          <Button
            onClick={() => setIsAddOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            <Plus className="h-4 w-4" />
            {addLabel}
          </Button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* FILTER BAR — UI READY, deliberately inert.
            The list endpoint takes `limit` and `cursor` and nothing else: no
            search, no status filter, no branch. Wiring these to client-side
            filtering would filter ONE PAGE and look like it filtered the list,
            which is a worse answer than none. They stay visible, disabled, and
            labelled, so the shape of the feature survives until the API does. */}
        <fieldset
          disabled
          className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center bg-gray-50/50 opacity-60"
          title={t('filterNotSupported')}
        >
          <div className="relative w-full sm:w-64 flex-shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              type="text"
              placeholder={t('searchPlaceholder')}
              className="pl-9 h-9 w-full bg-white border-gray-200"
              aria-describedby="filters-unavailable"
            />
          </div>

          <Select>
            <SelectTrigger className="w-full sm:w-[160px] h-9 bg-white border-gray-200">
              <SelectValue placeholder={t('departmentAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('departmentAll')}</SelectItem>
            </SelectContent>
          </Select>

          <Select>
            <SelectTrigger className="w-full sm:w-[150px] h-9 bg-white border-gray-200">
              <SelectValue placeholder={t('statusAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('statusAll')}</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" className="h-9 gap-2 border-gray-200 bg-white ml-auto">
            <Filter className="h-4 w-4" />
            {t('filterBtn')}
          </Button>
        </fieldset>
        <p id="filters-unavailable" className="px-4 py-2 text-xs text-gray-500 bg-gray-50/50">
          {t('filterNotSupported')}
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50/50">
              <TableRow>
                <TableHead className="w-[50px] text-center font-semibold text-gray-600">
                  {t('colIndex')}
                </TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colEmployee')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
                <TableHead className="font-semibold text-gray-600">{t('colJoinedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((membership, index) => (
                <TableRow key={membership.id} className="hover:bg-blue-50/30 transition-colors">
                  <TableCell className="text-center text-gray-500 font-medium">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 ring-1 ring-gray-100">
                        <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">
                          {membership.user.displayName.trim().charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        {/* The projected name — not the UUID underneath it. */}
                        <span className="font-medium text-gray-900">
                          {membership.user.displayName}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <MembershipStatusBadge status={membership.status} />
                  </TableCell>
                  <TableCell className="text-gray-600">
                    {formatDate(membership.createdAt, language)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {!page.loading && page.items.length === 0 && !page.error && (
            <p className="px-6 py-10 text-center text-sm text-gray-500">{t('emptyMembers')}</p>
          )}

          {page.forbidden && (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
              <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
            </div>
          )}

          {page.error && !page.forbidden && (
            <p className="px-6 py-10 text-center text-sm text-red-600">{t('loadFailed')}</p>
          )}
        </div>

        <CursorPagination
          shown={page.items.length}
          hasMore={page.hasMore}
          canGoBack={page.canGoBack}
          onNext={page.next}
          onPrevious={page.previous}
          pageSize={page.pageSize}
          onPageSizeChange={page.setPageSize}
          isLoading={page.loading}
          className="border-t border-gray-100 bg-gray-50/30"
        />
      </div>

      <AddEmployeeModal
        isOpen={isAddOpen}
        departmentId={departmentId}
        onClose={() => setIsAddOpen(false)}
        onCreated={() => setRefresh((n) => n + 1)}
      />
    </div>
  );
}

/** The MEMBERSHIP's status — `active` or `ended`. Not the user's account state. */
function MembershipStatusBadge({ status }: Readonly<{ status: MembershipStatus }>) {
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
