import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDepartmentMutations } from '@/hooks/organization/useDepartmentAdmin';
import { isApiError } from '@/utils/errors';
import { notifySuccess } from '@/utils/toast';
import {
  DEPARTMENT_FUNCTIONS,
  type Department,
  type DepartmentFunction,
} from '@/types/organization';
import type { TranslationKey } from '@/types/translate';

/** The label of each function, from the one canonical list. */
export const FUNCTION_LABEL: Record<DepartmentFunction, TranslationKey> = {
  sales: 'functionSales',
  accounting: 'functionAccounting',
  dispatch: 'functionDispatch',
  customer_service: 'functionCustomerService',
};

/** The `<select>` cannot hold `null`, so an ordinary unit is the empty option. */
const NONE = '';

const toFunction = (value: string): DepartmentFunction | null =>
  (DEPARTMENT_FUNCTIONS as readonly string[]).includes(value) ? (value as DepartmentFunction) : null;

interface DepartmentFormModalProps {
  /** Absent means "create". Present means "correct this unit" — its slug is shown and not editable. */
  editing: Department | null;
  /** Called on cancel and after a save; the mutation itself re-reads the directory. */
  onClose: () => void;
}

/**
 * Create a unit, or rename it and set what it is for.
 *
 * Mount only while open — the page renders it conditionally — so every visit
 * starts from the row (or from blank) rather than from an abandoned edit.
 *
 * ★ THE SLUG IS TYPED ONCE. `PATCH /departments/:id` accepts `name` and
 * `function` and nothing else: things point at the slug, so the contract
 * makes it immutable, and this form shows it read-only rather than offering
 * an edit the server would refuse.
 *
 * ★ THE FUNCTION IS THE CLOSED LIST FROM THE TYPE, not strings typed here. A
 * value outside it is refused by the server (422) before the database's
 * CHECK ever sees it; `null` is a real answer — an ordinary unit — sent
 * explicitly on edit so that "clear it" is distinguishable from "leave it".
 */
export function DepartmentFormModal({ editing, onClose }: Readonly<DepartmentFormModalProps>) {
  const { t } = useLanguage();
  const { create, update } = useDepartmentMutations();
  const [slug, setSlug] = useState(editing?.slug ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [fn, setFn] = useState<string>(editing?.function ?? NONE);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const busy = create.isPending || update.isPending;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const trimmedSlug = slug.trim();
    const trimmedName = name.trim();
    const missing: Record<string, string> = {};
    if (!editing && trimmedSlug === '') missing['slug'] = t('fieldRequired');
    if (trimmedName === '') missing['name'] = t('fieldRequired');
    setFieldErrors(missing);
    if (Object.keys(missing).length > 0) return;

    try {
      if (editing) {
        await update.mutateAsync({ departmentId: editing.id, name: trimmedName, function: toFunction(fn) });
        notifySuccess('departmentUpdated');
      } else {
        await create.mutateAsync({ slug: trimmedSlug, name: trimmedName, function: toFunction(fn) });
        notifySuccess('departmentCreated');
      }
      onClose();
    } catch (error_) {
      if (isApiError(error_)) {
        // 422 carries a message per field; 409 (slug taken) and 403 carry one
        // sentence. Shown verbatim: the server's words say what is wrong.
        if (error_.details) setFieldErrors(error_.details);
        setError(error_.message);
      } else {
        setError(t('saveFailed'));
      }
    }
  };

  const formId = 'department-form';

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(editing ? 'editDepartment' : 'addDepartment')}
      footer={
        <>
          <Button variant="outline" type="button" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
            {busy ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="department-slug" className="text-sm font-medium text-gray-700">
            {t('fieldSlug')}
          </label>
          <Input
            id="department-slug"
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            readOnly={editing !== null}
            disabled={busy}
            required={editing === null}
            aria-describedby="department-slug-hint"
            aria-invalid={fieldErrors['slug'] !== undefined}
          />
          <p id="department-slug-hint" className="text-xs text-gray-500">
            {t('slugHint')}
          </p>
          {fieldErrors['slug'] && <p className="text-sm text-red-600">{fieldErrors['slug']}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor="department-name" className="text-sm font-medium text-gray-700">
            {t('fieldDepartmentName')}
          </label>
          <Input
            id="department-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            required
            aria-invalid={fieldErrors['name'] !== undefined}
          />
          {fieldErrors['name'] && <p className="text-sm text-red-600">{fieldErrors['name']}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor="department-function" className="text-sm font-medium text-gray-700">
            {t('fieldFunction')}
          </label>
          {/* A native select, as every form inside a `Modal` uses: the portalled
              `Select` primitive escapes the dialog's focus trap. */}
          <select
            id="department-function"
            value={fn}
            onChange={(event) => setFn(event.target.value)}
            disabled={busy}
            aria-describedby="department-function-hint"
            className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value={NONE}>{t('functionNone')}</option>
            {DEPARTMENT_FUNCTIONS.map((value) => (
              <option key={value} value={value}>
                {t(FUNCTION_LABEL[value])}
              </option>
            ))}
          </select>
          <p id="department-function-hint" className="text-xs text-gray-500">
            {t('functionHint')}
          </p>
          {fieldErrors['function'] && <p className="text-sm text-red-600">{fieldErrors['function']}</p>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
