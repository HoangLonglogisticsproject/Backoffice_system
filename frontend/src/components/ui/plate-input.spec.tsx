import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlateInput } from './plate-input';

/**
 * A host that behaves like every real caller: it holds the PLAIN plate and
 * hands it straight back. Anything these tests observe about the display is
 * therefore the component's doing, not the harness's.
 */
function Host({ initial = '', onPlain }: { initial?: string; onPlain?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="plate">Plate</label>
      <PlateInput
        id="plate"
        value={value}
        onChange={(plain) => {
          onPlain?.(plain);
          setValue(plain);
        }}
      />
    </>
  );
}

const field = () => screen.getByLabelText('Plate') as HTMLInputElement;

/**
 * ★ THE NATIVE SETTER, NOT `fireEvent.change`.
 *
 * React installs its own `value` setter on the mounted node and keeps a change
 * tracker behind it; assigning through that override updates the tracker too, so
 * React concludes nothing changed. Going through the prototype leaves the
 * tracker stale — exactly what a real keystroke does — and it is the only way to
 * set the caret BEFORE the event, which is the whole point of the cases below.
 * Same helper `money-input.spec` uses, for the same reason.
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

const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

/**
 * ★ THE STATE IS THE PAYLOAD, THE DISPLAY IS A VIEW OF IT.
 *
 * The whole point of this control: a form holding it can hand its state
 * straight to `createTripVehicle` without remembering to strip anything, and
 * the person typing still reads a plate rather than a run of characters.
 */
describe('PlateInput', () => {
  /**
   * ★ ONE CASE, THREE SPELLINGS OF THE SAME LORRY.
   *
   * What is typed differs — run together, lower case, already dashed — and what
   * the field shows and what it sends must not. That is the whole contract:
   * the display is a view, the state is the payload.
   */
  it.each([
    ['run together', '50AA123333', '50AA-123333', '50AA123333'],
    ['in lower case', '50h44266', '50H-44266', '50H44266'],
    ['already dashed', '51D-65233', '51D-65233', '51D65233'],
  ])('★ typed %s: shows the dash and hands back the plain plate', (_how, typed, shown, sent) => {
    const onPlain = vi.fn();
    render(<Host onPlain={onPlain} />);

    type(typed);

    expect(field().value).toBe(shown);
    // What travels: no separator, the shape `plate_key` is generated from.
    expect(onPlain).toHaveBeenLastCalledWith(sent);
  });

  it('leaves a half-typed plate alone rather than reshaping it mid-keystroke', () => {
    render(<Host />);

    type('50');
    expect(field().value).toBe('50');
    type('50A');
    expect(field().value).toBe('50A');
    // The dash arrives only once there is a registration number to separate.
    type('50A1234');
    expect(field().value).toBe('50A-1234');
  });

  it('seeds from a stored plate, showing it the one way', () => {
    render(<Host initial="51D65233" />);

    expect(field().value).toBe('51D-65233');
  });

  /**
   * ★ BACKSPACE ON THE DASH DELETES THE CHARACTER BEFORE IT.
   *
   * Nobody typed the dash, so removing one leaves the plate identical and the
   * formatter puts it straight back — which reads as a broken key: the caret
   * sits after `50AA-` and Backspace does nothing, forever.
   */
  it('★ backspacing the dash removes a real character, and terminates', () => {
    const onPlain = vi.fn();
    render(<Host initial="50AA123333" onPlain={onPlain} />);

    expect(field().value).toBe('50AA-123333');

    // Caret just after the dash; Backspace removes the dash itself.
    edit(field(), '50AA123333', 4);

    // The character the person meant went instead, and the display settles —
    // press it again and it keeps deleting rather than sitting dead.
    expect(onPlain).toHaveBeenLastCalledWith('50A123333');
    expect(field().value).toBe('50A-123333');
  });

  it('hands back an empty string when the field is cleared', () => {
    const onPlain = vi.fn();
    render(<Host initial="50H44266" onPlain={onPlain} />);

    type('');

    expect(onPlain).toHaveBeenLastCalledWith('');
    expect(field().value).toBe('');
  });

  it('drops punctuation somebody pasted, rather than storing it', () => {
    const onPlain = vi.fn();
    render(<Host onPlain={onPlain} />);

    // The workbook's other spelling, pasted straight in.
    type('51D.65233');

    expect(onPlain).toHaveBeenLastCalledWith('51D65233');
    expect(field().value).toBe('51D-65233');
  });
});
