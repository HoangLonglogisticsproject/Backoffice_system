import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { DateInput } from './date-input';
import { DateTimeInput } from './date-time-input';
import { TimeInput } from './time-input';

/** One control, held by real state, reporting every value the form would receive. */
function Harness({
  kind,
  initial = '',
  min,
  seen = () => {},
}: {
  kind: 'time' | 'date' | 'datetime';
  initial?: string;
  min?: string;
  seen?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const onChange = (next: string) => {
    seen(next);
    setValue(next);
  };
  return (
    <LanguageProvider>
      <label htmlFor="f">Thời gian</label>
      {kind === 'time' && <TimeInput id="f" value={value} onChange={onChange} min={min} />}
      {kind === 'date' && <DateInput id="f" value={value} onChange={onChange} min="2026-10-03" />}
      {kind === 'datetime' && <DateTimeInput id="f" value={value} onChange={onChange} timeLabel="Giờ giao" />}
      <output data-testid="value">{value}</output>
    </LanguageProvider>
  );
}
const field = () => screen.getByLabelText('Thời gian') as HTMLInputElement;
const held = () => screen.getByTestId('value').textContent;
const column = (name: RegExp) => within(screen.getByRole('listbox', { name }));
const option = (name: RegExp, text: string) => column(name).getByRole('option', { name: text });
/** Opens the picker on `control` and chooses hour, minute and period by clicking. */
const pick = (control: HTMLElement, hour: string, minute: string, period: 'AM' | 'PM') => {
  if (control.getAttribute('aria-expanded') !== 'true') fireEvent.click(control);
  fireEvent.click(option(/^Giờ$/, hour));
  fireEvent.click(option(/^Phút$/, minute));
  fireEvent.click(option(/AM\/PM/, period));
};

describe('TimeInput — a picked hour, laid out by the Backoffice', () => {
  it('★ opens a picker on click — hour, minute, AM/PM — with nothing to type', () => {
    render(<Harness kind="time" />);
    expect(field()).toHaveAttribute('role', 'combobox');
    expect(field()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(field()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(field());

    expect(field()).toHaveAttribute('aria-expanded', 'true');
    const popup = document.getElementById(field().getAttribute('aria-controls')!)!;
    expect(within(popup).getByRole('dialog', { name: 'Chọn giờ' })).toBeVisible();
    expect(column(/^Giờ$/).getAllByRole('option').map((o) => o.textContent)).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
    );
    // Every minute, 00 to 59.
    expect(column(/^Phút$/).getAllByRole('option').map((o) => o.textContent)).toEqual(
      Array.from({ length: 60 }, (_, m) => String(m).padStart(2, '0')),
    );
    // ★ AM before PM — fixed, not the browser's locale.
    expect(column(/AM\/PM/).getAllByRole('option').map((o) => o.textContent)).toEqual(['AM', 'PM']);
  });

  it.each([
    ['09', '30', 'AM', '09:30', '09:30 AM'],
    ['09', '30', 'PM', '21:30', '09:30 PM'],
    ['09', '28', 'PM', '21:28', '09:28 PM'],
    ['10', '52', 'AM', '10:52', '10:52 AM'],
    ['12', '05', 'AM', '00:05', '12:05 AM'],
  ] as const)('★ %s : %s : %s is %s in the form, %s on screen', (hour, minute, period, canonical, shown) => {
    render(<Harness kind="time" />);
    pick(field(), hour, minute, period);
    expect(held()).toBe(canonical);
    expect(field()).toHaveValue(shown);
  });

  it('★ takes no typing — a key reaches nothing — but reads a pasted hour', () => {
    render(<Harness kind="time" />);
    expect(fireEvent.keyDown(field(), { key: '9' })).toBe(false);
    expect(field()).toHaveValue('');

    fireEvent.change(field(), { target: { value: '21:30' } });
    expect(held()).toBe('21:30');
    expect(field()).toHaveValue('09:30 PM');
  });

  it('★ a half-chosen hour is no hour: the form gets nothing and the field is invalid until it is whole', () => {
    const seen = vi.fn();
    render(<Harness kind="time" seen={seen} />);
    fireEvent.click(field());
    fireEvent.click(option(/^Giờ$/, '09'));

    expect(seen).toHaveBeenLastCalledWith('');
    expect(field()).toHaveValue('09:-- --');
    // Never submittable — but not shouted while the picker is still open.
    expect(field().validationMessage).toBe('Chọn đủ giờ, phút và AM/PM.');

    fireEvent.click(option(/^Phút$/, '30'));
    fireEvent.click(option(/AM\/PM/, 'PM'));
    expect(seen).toHaveBeenLastCalledWith('21:30');
    expect(field().validity.valid).toBe(true);
  });

  it('says a half-chosen hour only once the picker is closed — not while it is being chosen', () => {
    const told = vi.fn();
    render(
      <LanguageProvider>
        <label htmlFor="g">Giờ thử</label>
        <TimeInput id="g" value="" onChange={() => {}} onFormatError={told} />
      </LanguageProvider>,
    );
    const control = screen.getByLabelText('Giờ thử');
    fireEvent.click(control);
    fireEvent.click(option(/^Giờ$/, '09'));
    expect(told).toHaveBeenLastCalledWith(null);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(told).toHaveBeenLastCalledWith('Chọn đủ giờ, phút và AM/PM.');
  });

  it('★ is worked by keyboard: arrows choose, ←/→ change column, Escape closes back to the field and goes no further', () => {
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    render(<Harness kind="time" initial="09:30" />);
    field().focus();

    fireEvent.keyDown(field(), { key: 'ArrowDown' });
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    // The hour column has the focus, its chosen hour active.
    const hours = screen.getByRole('listbox', { name: /^Giờ$/ });
    expect(document.activeElement).toBe(hours);
    expect(hours).toHaveAttribute('aria-activedescendant', option(/^Giờ$/, '09').id);

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(held()).toBe('10:30');
    expect(hours).toHaveAttribute('aria-activedescendant', option(/^Giờ$/, '10').id);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    const minutes = screen.getByRole('listbox', { name: /^Phút$/ });
    expect(document.activeElement).toBe(minutes);
    expect(minutes).toHaveAttribute('aria-activedescendant', option(/^Phút$/, '30').id);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(held()).toBe('22:31');

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(field());
    // The dialog around the form never heard that Escape.
    expect(outside).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    document.removeEventListener('keydown', outside);
  });

  describe('★ with today’s floor at 22:06 — the current business minute', () => {
    it('closes AM and the PM hours already gone; at 10 PM, 22:05 is closed, 22:06 and 22:07 open', () => {
      render(<Harness kind="time" min="22:06" />);
      fireEvent.click(field());

      expect(option(/AM\/PM/, 'AM')).toHaveAttribute('aria-disabled', 'true');
      expect(option(/^Giờ$/, '09')).toHaveAttribute('aria-disabled', 'true');
      expect(option(/^Giờ$/, '10')).not.toHaveAttribute('aria-disabled');

      fireEvent.click(option(/^Giờ$/, '10'));
      fireEvent.click(option(/AM\/PM/, 'PM'));
      expect(option(/^Phút$/, '05')).toHaveAttribute('aria-disabled', 'true');
      expect(option(/^Phút$/, '06')).not.toHaveAttribute('aria-disabled');
      expect(option(/^Phút$/, '07')).not.toHaveAttribute('aria-disabled');

      // A closed minute cannot be chosen; the current one can.
      fireEvent.click(option(/^Phút$/, '05'));
      expect(held()).toBe('');
      fireEvent.click(option(/^Phút$/, '06'));
      expect(held()).toBe('22:06');
    });

    it('moves the minute column to the first minute still open — 06 at 10 PM', () => {
      render(<Harness kind="time" min="22:06" />);
      fireEvent.click(field());
      fireEvent.click(option(/^Giờ$/, '10'));
      fireEvent.click(option(/AM\/PM/, 'PM'));
      expect(screen.getByRole('listbox', { name: /^Phút$/ })).toHaveAttribute(
        'aria-activedescendant',
        option(/^Phút$/, '06').id,
      );
    });

    it('leaves a later day wholly open — no floor', () => {
      render(<Harness kind="time" />);
      fireEvent.click(field());
      const closed = screen.getAllByRole('option').filter((o) => o.getAttribute('aria-disabled') === 'true');
      expect(closed).toEqual([]);
    });
  });

  it('★ Enter on a column chooses its active option and closes the picker back to the field', () => {
    render(<Harness kind="time" initial="09:30" />);
    fireEvent.click(field());
    const periods = screen.getByRole('listbox', { name: /AM\/PM/ });
    fireEvent.keyDown(periods, { key: 'ArrowDown' });
    fireEvent.keyDown(periods, { key: 'Enter' });

    expect(held()).toBe('21:30');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(field());
  });

  it('clears with "Xóa" and closes with "Xong"', () => {
    render(<Harness kind="time" initial="21:30" />);
    fireEvent.click(field());
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    expect(held()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Xong' }));
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('DateInput — dd/mm/yyyy in any browser', () => {
  it('★ shows a held day day-first', () => {
    render(<Harness kind="date" initial="2026-10-03" />);
    expect(field()).toHaveValue('03/10/2026');
  });

  it('★ takes 03102026 typed as digits, and a pasted 2026-10-03', () => {
    render(<Harness kind="date" />);
    fireEvent.change(field(), { target: { value: '03102026' } });
    expect(field()).toHaveValue('03/10/2026');
    expect(held()).toBe('2026-10-03');

    fireEvent.change(field(), { target: { value: '2026-10-04' } });
    expect(field()).toHaveValue('04/10/2026');
    expect(held()).toBe('2026-10-04');
  });

  it('★ an impossible day is no day: the form gets nothing and the control is invalid', () => {
    const seen = vi.fn();
    render(<Harness kind="date" seen={seen} />);
    fireEvent.change(field(), { target: { value: '31/02/2026' } });
    expect(seen).toHaveBeenLastCalledWith('');
    expect(field().validationMessage).toBe('Nhập ngày theo dạng dd/mm/yyyy.');
  });

  it('★ a day picked on the calendar is shown day-first, and the calendar holds no value of its own', () => {
    render(<Harness kind="date" />);
    const calendar = document.getElementById('f-calendar') as HTMLInputElement;
    expect(calendar).toHaveAttribute('min', '2026-10-03');
    expect(screen.getByRole('button', { name: 'Chọn ngày trên lịch' })).toBeInTheDocument();

    fireEvent.change(calendar, { target: { value: '2026-10-09' } });
    expect(field()).toHaveValue('09/10/2026');
    expect(held()).toBe('2026-10-09');
    expect(calendar.value).toBe('');
  });
});

describe('DateTimeInput — a typed day and a picked hour, as one moment', () => {
  const hour = () => screen.getByLabelText('Giờ giao') as HTMLInputElement;

  it('★ hands the form YYYY-MM-DDTHH:mm only once both halves are whole', () => {
    const seen = vi.fn();
    render(<Harness kind="datetime" seen={seen} />);
    fireEvent.change(field(), { target: { value: '05/10/2026' } });
    expect(seen).toHaveBeenLastCalledWith('');
    expect(hour().validationMessage).toBe('Nhập đủ cả ngày và giờ.');

    pick(hour(), '09', '30', 'PM');
    expect(seen).toHaveBeenLastCalledWith('2026-10-05T21:30');
    expect(hour()).toHaveValue('09:30 PM');
    expect(hour().validity.valid).toBe(true);
  });

  it('shows a held moment as its two halves', () => {
    render(<Harness kind="datetime" initial="2026-10-05T09:30" />);
    expect(field()).toHaveValue('05/10/2026');
    expect(hour()).toHaveValue('09:30 AM');
  });
});
