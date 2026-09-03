import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MoneyInput } from './money-input';

/**
 * A host that behaves like every real caller: it holds the PLAIN string and
 * hands it straight back. Anything these tests observe about the display is
 * therefore the component's doing, not the harness's.
 */
function Host({ initial = '', onPlain }: { initial?: string; onPlain?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="amount">Amount</label>
      <MoneyInput
        id="amount"
        value={value}
        onChange={(plain) => {
          setValue(plain);
          onPlain?.(plain);
        }}
      />
      <output data-testid="plain">{value}</output>
    </>
  );
}

const field = () => screen.getByLabelText('Amount') as HTMLInputElement;

/**
 * The prototype setter, deliberately.
 *
 * React overrides `value` on each controlled node to track what it last
 * rendered; assigning through that override updates the tracker too, so React
 * concludes nothing changed and never calls `onChange`. Going through the
 * prototype leaves the tracker stale, which is exactly what a real keystroke
 * does — and it is the only way to set the caret before the event, which is the
 * whole point of these cases.
 */
const setNativeValue = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)!.set!;

/** Replaces the field's contents and puts the caret at `caret`, as an edit would. */
function edit(input: HTMLInputElement, value: string, caret: number) {
  setNativeValue.call(input, value);
  input.setSelectionRange(caret, caret);
  fireEvent.input(input);
}

/** Types `text` at `caret`, the way a keypress would. */
function typeAt(input: HTMLInputElement, caret: number, text: string) {
  edit(input, input.value.slice(0, caret) + text + input.value.slice(caret), caret + text.length);
}

describe('MoneyInput', () => {
  it('shows the value grouped and keeps the state plain', () => {
    render(<Host initial="1500000" />);

    expect(field()).toHaveValue('1,500,000');
    expect(screen.getByTestId('plain')).toHaveTextContent('1500000');
  });

  it('★ reports the plain decimal, never the grouped display', () => {
    const onPlain = vi.fn();
    render(<Host onPlain={onPlain} />);

    fireEvent.change(field(), { target: { value: '1500000' } });

    // A comma reaching `createTripCost` would be refused by the server.
    expect(onPlain).toHaveBeenLastCalledWith('1500000');
    expect(field()).toHaveValue('1,500,000');
  });

  it('groups as each digit lands, not only when the field is done', () => {
    render(<Host />);

    for (const [typed, shown] of [
      ['1', '1'],
      ['5', '15'],
      ['0', '150'],
      ['0', '1,500'],
      ['0', '15,000'],
      ['0', '150,000'],
      ['0', '1,500,000'],
    ] as const) {
      typeAt(field(), field().value.length, typed);
      expect(field()).toHaveValue(shown);
    }
  });

  /**
   * ★ THE REASON THE COMPONENT EXISTS RATHER THAN A CALL TO `formatWithCommas`
   * IN EACH FORM.
   *
   * Re-formatting a controlled value on every keystroke sends the caret to the
   * end. Without the restoring effect, correcting a digit in the middle of an
   * amount is impossible — each keypress teleports you back to the end, and the
   * next one lands in the wrong place.
   */
  it('★ keeps the caret where the digit was typed, not at the end', () => {
    render(<Host initial="1500000" />);
    expect(field()).toHaveValue('1,500,000');

    // Insert a '9' right after the leading '1' → 19,500,000.
    typeAt(field(), 1, '9');

    expect(field()).toHaveValue('19,500,000');
    // Two display characters in — after '19', before the comma.
    expect(field().selectionStart).toBe(2);
    expect(screen.getByTestId('plain')).toHaveTextContent('19500000');
  });

  it('keeps the caret in place when the edit pushes a new separator in', () => {
    render(<Host initial="150000" />);
    expect(field()).toHaveValue('150,000');

    // 150,000 → 1,500,000: a comma appears to the LEFT of the caret, so a
    // restored raw offset would land one character short.
    typeAt(field(), 3, '0');

    expect(field()).toHaveValue('1,500,000');
    // Four plain digits are now behind the caret ('1500'), which is display
    // index 5 once the first comma is counted.
    expect(field().selectionStart).toBe(5);
  });

  describe('★ backspace', () => {
    it('★ deletes the digit when the caret is on a separator', () => {
      // A comma is not a character anybody typed. Removing one leaves the
      // number identical and the formatter puts it straight back — so, left
      // alone, the key would appear dead forever.
      render(<Host initial="1500000" />);

      // Caret after the first comma; Backspace removes that comma.
      edit(field(), '1500,000', 4);

      expect(field()).toHaveValue('150,000');
      expect(screen.getByTestId('plain')).toHaveTextContent('150000');
    });

    it('deletes a digit normally when the caret is on one', () => {
      render(<Host initial="1500000" />);

      edit(field(), '1,500,00', 8);

      expect(field()).toHaveValue('150,000');
      expect(screen.getByTestId('plain')).toHaveTextContent('150000');
    });

    it('empties cleanly', () => {
      render(<Host initial="1500000" />);

      fireEvent.change(field(), { target: { value: '' } });

      expect(field()).toHaveValue('');
      expect(screen.getByTestId('plain')).toHaveTextContent('');
    });
  });

  it('lets a decimal point be typed and kept', () => {
    render(<Host initial="1500000" />);

    typeAt(field(), 9, '.');
    expect(field()).toHaveValue('1,500,000.');

    typeAt(field(), 10, '5');
    expect(field()).toHaveValue('1,500,000.5');
    expect(screen.getByTestId('plain')).toHaveTextContent('1500000.5');
  });

  it('forwards the props a form needs', () => {
    render(
      <>
        <label htmlFor="amount">Amount</label>
        <MoneyInput id="amount" value="" onChange={() => {}} required placeholder="1,500,000" />
      </>,
    );

    expect(field()).toBeRequired();
    expect(field()).toHaveAttribute('placeholder', '1,500,000');
    // Not `type="number"`: that control coerces through a float and refuses to
    // display a grouped value at all.
    expect(field()).toHaveAttribute('inputmode', 'decimal');
    expect(field()).not.toHaveAttribute('type', 'number');
  });
});
