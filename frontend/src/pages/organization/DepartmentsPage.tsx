import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/contexts/LanguageContext';
import { useSession } from '@/contexts/SessionProvider';
import { useDepartmentDirectory, type DepartmentDirectoryRow } from '@/hooks/organization/useDepartmentAdmin';
import type { Department } from '@/types/organization';
import { DepartmentDetailModal } from './components/DepartmentDetailModal';
import { DepartmentFormModal, FUNCTION_LABEL } from './components/DepartmentFormModal';

/**
 * Every unit in the deployment, for the global administrator who runs them.
 *
 * ⚠ NONE OF THIS IS AUTHORIZATION. `GET /departments` and the roster it is
 * joined to are GLOBAL-only reads, so anybody else sees the same refusal the
 * server gives (403, drawn as a state); the controls read `unit.write`,
 * `role.assign`, `unit.member.write` and `user.write` from the session to
 * decide what to DRAW, and the server re-decides every request.
 */
export default function DepartmentsPage() {
  const { t } = useLanguage();
  const { can } = useSession();
  const directory = useDepartmentDirectory();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [viewing, setViewing] = useState<Department | null>(null);

  const mayWrite = can('unit.write');
  // The row on screen is re-read after every change, so the open dialog
  // follows the server rather than the click that opened it.
  const viewed = viewing
    ? (directory.rows.find((row) => row.department.id === viewing.id)?.department ?? viewing)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('departments')}
        subtitle={t('departmentsSubtitle')}
        actions={
          mayWrite ? (
            <Button className="gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              {t('addDepartment')}
            </Button>
          ) : undefined
        }
      />

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <Table>
          <TableHeader className="bg-gray-50/50">
            <TableRow>
              <TableHead className="font-semibold text-gray-600">{t('colDepartmentName')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colFunction')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colSlug')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colHead')}</TableHead>
              <TableHead className="text-right font-semibold text-gray-600">{t('colMembers')}</TableHead>
              <TableHead className="font-semibold text-gray-600">{t('colStatus')}</TableHead>
              <TableHead className="text-right font-semibold text-gray-600">{t('colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {directory.rows.map((row) => (
              <DepartmentRow
                key={row.department.id}
                row={row}
                mayWrite={mayWrite}
                onView={() => setViewing(row.department)}
                onEdit={() => setEditing(row.department)}
              />
            ))}
          </TableBody>
        </Table>

        {directory.loading && directory.rows.length === 0 && (
          <p className="px-6 py-10 text-center text-sm text-gray-500">{t('loading')}</p>
        )}
        {!directory.loading && directory.rows.length === 0 && !directory.error && (
          <p className="px-6 py-10 text-center text-sm text-gray-500">{t('emptyDepartments')}</p>
        )}
        {directory.forbidden && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-medium text-gray-900">{t('forbiddenTitle')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('forbiddenBody')}</p>
          </div>
        )}
        {directory.error && !directory.forbidden && (
          <p className="px-6 py-10 text-center text-sm text-red-600">{t('loadFailed')}</p>
        )}
      </div>

      {/* Mounted only while open, so each visit seeds from the row (or blank). */}
      {creating && <DepartmentFormModal editing={null} onClose={() => setCreating(false)} />}
      {editing && <DepartmentFormModal editing={editing} onClose={() => setEditing(null)} />}
      {viewed && (
        <DepartmentDetailModal
          department={viewed}
          roster={directory.roster}
          onClose={() => setViewing(null)}
          onChanged={directory.reload}
        />
      )}
    </div>
  );
}

function DepartmentRow({
  row,
  mayWrite,
  onView,
  onEdit,
}: Readonly<{
  row: DepartmentDirectoryRow;
  mayWrite: boolean;
  onView: () => void;
  onEdit: () => void;
}>) {
  const { t } = useLanguage();
  const { department } = row;
  const archived = department.status !== 'active';

  return (
    <TableRow className={archived ? 'opacity-60' : 'transition-colors hover:bg-blue-50/30'}>
      <TableCell className="font-medium text-gray-900">{department.name}</TableCell>
      <TableCell>{department.function ? t(FUNCTION_LABEL[department.function]) : t('functionNone')}</TableCell>
      <TableCell className="font-mono text-xs text-gray-600">{department.slug}</TableCell>
      <TableCell>{row.head?.displayName ?? '—'}</TableCell>
      <TableCell className="text-right tabular-nums">{row.memberCount}</TableCell>
      <TableCell>
        <StatusPill tone={archived ? 'gray' : 'green'}>
          {t(archived ? 'statusArchived' : 'departmentActive')}
        </StatusPill>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onView}>
            {t('viewDepartment')}
          </Button>
          {mayWrite && (
            <Button type="button" variant="ghost" size="sm" onClick={onEdit} disabled={archived}>
              <Pencil className="h-3.5 w-3.5" />
              <span className="sr-only">{t('edit')}</span>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
