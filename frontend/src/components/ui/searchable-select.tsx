import { Combobox } from '@base-ui/react/combobox';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * A select you can type into.
 *
 * ★ BUILT BECAUSE THE LISTS OUTGREW A DROPDOWN. Thirty-four provinces is
 * already a scroll; Hồ Chí Minh alone has 168 wards after the 2025 merger, and
 * finding "Phường Tân Thuận" in that by eye is the slowest thing on the form.
 * Typing three letters is the whole feature.
 *
 * ★ A COMBOBOX, NOT A SELECT WITH A SEARCH BOX BOLTED ON. Base UI ships the
 * primitive, so the filtering, the keyboard handling and the ARIA wiring are
 * the library's rather than ours — and the input IS the trigger, which is what
 * makes it faster: focus lands somewhere you can already type.
 *
 * ★ THE VALUE IS A STRING WE CHOOSE, NOT THE LABEL. Callers pass
 * `{ value, label }` and get the `value` back. That matters where a name is not
 * unique — the administrative feed has genuinely different wards sharing a
 * code, so the caller encodes code AND name into `value` and this never has to
 * know.
 *
 * ★ AND IT IS NOT FREE TEXT. `Combobox.Empty` says nothing matched; whatever is
 * typed but unmatched is discarded on close. This picks from a list — a
 * province the state does not issue is not a province.
 */

export interface SearchableOption {
  value: string;
  label: string;
}

export function SearchableSelect({
  id,
  items,
  value,
  onValueChange,
  placeholder,
  emptyText,
  disabled = false,
  className,
}: Readonly<{
  id?: string;
  items: SearchableOption[];
  /** `null`, never `undefined` — an uncontrolled-then-controlled input is a React warning and a lost value. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  emptyText: string;
  disabled?: boolean;
  className?: string;
}>) {
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <Combobox.Root
      items={items}
      value={selected}
      disabled={disabled}
      onValueChange={(next) => onValueChange((next as SearchableOption | null)?.value ?? null)}
    >
      <Combobox.InputGroup className={cn('relative flex w-full items-center', className)}>
        <Combobox.Input
          id={id}
          placeholder={placeholder}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-transparent py-2 pr-8 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Combobox.Trigger
          className="absolute right-0 flex h-full w-8 items-center justify-center text-muted-foreground disabled:opacity-50"
          aria-label={placeholder}
          disabled={disabled}
        >
          <ChevronDownIcon className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>

      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50" sideOffset={4}>
          <Combobox.Popup className="max-h-[min(20rem,var(--available-height))] w-(--anchor-width) overflow-y-auto rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Combobox.Empty className="px-3 py-3 text-sm text-muted-foreground">
              {emptyText}
            </Combobox.Empty>
            <Combobox.List>
              {(item: SearchableOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  {/* Wrapped so a long Vietnamese unit name truncates instead of
                      widening the popup past the dialog it opened inside. */}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <Combobox.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
