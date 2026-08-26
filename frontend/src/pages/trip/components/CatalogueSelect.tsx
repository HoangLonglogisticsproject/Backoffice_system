import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/contexts/LanguageContext';
import { isApiError } from '@/utils/errors';

interface CatalogueOption {
  id: string;
  label: string;
}

interface CatalogueSelectProps {
  id: string;
  label: string;
  placeholder: string;
  options: CatalogueOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Adds a row to the catalogue and returns it. Any signed-in caller may. */
  onCreate: (label: string) => Promise<CatalogueOption>;
  newPlaceholder: string;
  disabled?: boolean;
}

/**
 * Pick a truck or a customer from the catalogue — or add one without leaving.
 *
 * ★ A NATIVE `<select>`, NOT THE `Select` PRIMITIVE. That component portals its
 * popup to the end of `<body>`, which puts it OUTSIDE the dialog element whose
 * focus trap this form lives in — so Tab inside the open popup would be caught
 * by the trap and yanked back into the form. The native control needs no portal,
 * is already in the trap's `FOCUSABLE` selector, and behaves correctly on a
 * phone. The `Select` primitive stays in filter bars, where there is no trap.
 *
 * ★ AND WHY "ADD NEW" IS HERE RATHER THAN ON THE CATALOGUE SCREEN. The whole
 * point of the catalogue is that plates and customer names stop being typed
 * free-hand — the workbook accumulated `50H44266` beside `50H49266` for one
 * truck. That discipline survives only if adding a missing row is easier than
 * working around it. A dispatcher who has to leave the form, find the catalogue
 * screen, add the customer and start over will instead put the name in the
 * cargo note, and the catalogue is bypassed on exactly the rows it exists for.
 */
export function CatalogueSelect({
  id,
  label,
  placeholder,
  options,
  value,
  onChange,
  onCreate,
  newPlaceholder,
  disabled = false,
}: Readonly<CatalogueSelectProps>) {
  const { t } = useLanguage();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = draft.trim();
    if (trimmed === '') return;

    setBusy(true);
    setError(null);

    try {
      const created = await onCreate(trimmed);
      // Selected immediately: adding it in order to NOT use it is not a thing
      // anybody wants, and making them pick it again from the list is a step
      // that exists only because the code was easier to write that way.
      onChange(created.id);
      setDraft('');
      setAdding(false);
    } catch (error_) {
      // The 409 here is the useful one — it names the spelling already in the
      // catalogue, e.g. "already in the catalogue, as 51D.65233". Showing the
      // server's message verbatim is what tells the user their truck IS there,
      // written differently.
      setError(isApiError(error_) ? error_.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>

      <div className="flex items-stretch gap-2">
        <select
          id={id}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
          disabled={disabled || adding}
          className="h-9 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {/*
            The empty option is a real answer, not a prompt to be dismissed: a
            trip with no truck assigned yet is a state the workbook wrote as
            `ĐIỀN SAU`, and the API stores it as null.
          */}
          <option value="">{t('notSelected')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1 px-2 text-gray-600"
          onClick={() => {
            setAdding((open) => !open);
            setError(null);
          }}
          disabled={disabled}
          aria-expanded={adding}
          aria-controls={`${id}-new`}
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">{placeholder}</span>
        </Button>
      </div>

      {adding && (
        <div id={`${id}-new`} className="flex items-stretch gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={newPlaceholder}
            aria-label={placeholder}
            className="h-9"
            // ★ Enter must NOT submit the trip form. This input is a nested
            // action inside a larger form, and a bare Enter here would post a
            // half-filled trip instead of creating the catalogue row.
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void create();
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-9 bg-blue-600 hover:bg-blue-700"
            onClick={() => void create()}
            disabled={busy || draft.trim() === ''}
          >
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
