import * as React from 'react';
import { cn } from '@/utils/cn';

export interface ColumnOption<V> {
  value: V;
  text: string;
  disabled: boolean;
  /** Drawn a little stronger — the quarter hours on the minute column. */
  emphasis?: boolean;
}

/** The next pickable index from `from`, stepping by `step`; `from` itself when there is none. */
const nextEnabled = <V,>(options: ColumnOption<V>[], from: number, step: number): number => {
  let index = from + step;
  while (options[index]?.disabled) index += step;
  return options[index] ? index : from;
};

/**
 * One column of a picker — a single-choice listbox: click an option, or move
 * with the arrow keys (the selection follows), Home/End to the ends, ←/→ to
 * the neighbouring column. Disabled options are skipped and cannot be chosen.
 * Knows nothing about what it lists; `TimeInput` builds its hour, minute and
 * AM/PM columns from it.
 */
export function PickerColumn<V extends string | number>({
  label,
  options,
  selected,
  onSelect,
  autoFocus = false,
}: Readonly<{
  label: string;
  options: ColumnOption<V>[];
  selected: V | null;
  onSelect: (value: V) => void;
  autoFocus?: boolean;
}>) {
  const list = React.useRef<HTMLDivElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === selected);
  const [active, setActive] = React.useState(() =>
    selectedIndex >= 0 ? selectedIndex : Math.max(nextEnabled(options, -1, 1), 0),
  );
  const optionAt = (index: number) => list.current?.children[index] as HTMLElement | undefined;

  // When a choice in another column closes the option this column stands on —
  // 10 PM at 22:06 closes the minutes before 06 — move to the first one open.
  const standingOnClosed = options[active]?.disabled ?? false;
  React.useEffect(() => {
    const open = nextEnabled(options, -1, 1);
    if (standingOnClosed && selectedIndex < 0 && open >= 0) setActive(open);
  }, [standingOnClosed]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    optionAt(active)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  React.useEffect(() => {
    if (autoFocus) optionAt(active)?.focus();
    // On open only: the first column takes the focus.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setActive(index);
    onSelect(option.value);
    optionAt(index)?.focus();
  };

  const toColumn = (step: number) => {
    const columns = Array.from(list.current?.parentElement?.querySelectorAll<HTMLElement>('[role="listbox"]') ?? []);
    const target = columns[columns.indexOf(list.current!) + step];
    target?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => void> = {
      ArrowDown: () => pick(nextEnabled(options, active, 1)),
      ArrowUp: () => pick(nextEnabled(options, active, -1)),
      Home: () => pick(nextEnabled(options, -1, 1)),
      End: () => pick(nextEnabled(options, options.length, -1)),
      ArrowRight: () => toColumn(1),
      ArrowLeft: () => toColumn(-1),
      ' ': () => pick(active),
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    } else if (event.key === 'Enter') {
      pick(active);
    }
  };

  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="custom-scrollbar h-52 flex-1 overflow-y-auto rounded-md bg-gray-50/60 p-0.5"
    >
      {options.map((option, index) => (
        <div
          key={String(option.value)}
          role="option"
          aria-selected={option.value === selected}
          aria-disabled={option.disabled || undefined}
          tabIndex={index === active ? 0 : -1}
          onClick={() => pick(index)}
          className={cn(
            'cursor-pointer rounded px-2 py-1 text-center text-sm tabular-nums outline-none select-none',
            'hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500',
            option.emphasis ? 'font-semibold text-gray-900' : 'text-gray-700',
            option.value === selected && 'bg-blue-600 text-white hover:bg-blue-600',
            option.disabled && 'cursor-not-allowed text-gray-300 hover:bg-transparent',
          )}
        >
          {option.text}
        </div>
      ))}
    </div>
  );
}
