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
 * One column of a picker — a single-choice listbox. The listbox itself takes
 * the focus and names its active option (`aria-activedescendant`): click an
 * option, or move with the arrow keys (the selection follows), Home/End to
 * the ends, ←/→ to the neighbouring column, Enter to choose and finish.
 * Disabled options are skipped and cannot be chosen. Knows nothing about what
 * it lists; `TimeInput` builds its hour, minute and AM/PM columns from it.
 */
export function PickerColumn<V extends string | number>({
  label,
  options,
  selected,
  onSelect,
  onDone,
  autoFocus = false,
}: Readonly<{
  label: string;
  options: ColumnOption<V>[];
  selected: V | null;
  onSelect: (value: V) => void;
  /** Enter: the active option is chosen and the picker is done. */
  onDone: () => void;
  autoFocus?: boolean;
}>) {
  const list = React.useRef<HTMLDivElement>(null);
  const baseId = React.useId();
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const selectedIndex = options.findIndex((option) => option.value === selected);
  const [active, setActive] = React.useState(() =>
    selectedIndex >= 0 ? selectedIndex : Math.max(nextEnabled(options, -1, 1), 0),
  );

  // When a choice in another column closes the option this column stands on —
  // 10 PM at 22:06 closes the minutes before 06 — move to the first one open.
  const standingOnClosed = options[active]?.disabled ?? false;
  React.useEffect(() => {
    const open = nextEnabled(options, -1, 1);
    if (standingOnClosed && selectedIndex < 0 && open >= 0) setActive(open);
  }, [standingOnClosed]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    // On open only: the first column takes the focus.
    if (autoFocus) list.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setActive(index);
    onSelect(option.value);
  };

  const toColumn = (step: number) => {
    const columns = Array.from(list.current?.parentElement?.querySelectorAll<HTMLElement>('[role="listbox"]') ?? []);
    columns[columns.indexOf(list.current!) + step]?.focus();
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
      Enter: () => {
        pick(active);
        onDone();
      },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      move();
    }
  };

  // One click handler for the column: the option pressed is the one under the pointer.
  const onClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const pressed = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (pressed) pick(Number(pressed.dataset.index));
  };

  return (
    <div
      ref={list}
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={optionId(active)}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className="group custom-scrollbar h-52 flex-1 overflow-y-auto rounded-md bg-gray-50/60 p-0.5 outline-none"
    >
      {options.map((option, index) => (
        <div
          key={String(option.value)}
          id={optionId(index)}
          data-index={index}
          role="option"
          aria-selected={option.value === selected}
          aria-disabled={option.disabled || undefined}
          className={cn(
            'cursor-pointer rounded px-2 py-1 text-center text-sm tabular-nums select-none hover:bg-blue-50',
            option.emphasis ? 'font-semibold text-gray-900' : 'text-gray-700',
            option.value === selected && 'bg-blue-600 text-white hover:bg-blue-600',
            option.disabled && 'cursor-not-allowed text-gray-300 hover:bg-transparent',
            // The keyboard's place in the column, shown while the column has the focus.
            index === active && 'group-focus-visible:ring-2 group-focus-visible:ring-blue-500 group-focus-visible:ring-inset',
          )}
        >
          {option.text}
        </div>
      ))}
    </div>
  );
}
