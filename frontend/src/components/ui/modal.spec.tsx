import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './modal';
import { LanguageProvider } from '@/contexts/LanguageContext';

/**
 * A dialog a keyboard cannot escape from, and cannot escape OUT of.
 *
 * ★ THE TRAP IS THE SAFETY PROPERTY. The page behind a modal is still rendered
 * and still reachable by Tab, but it is invisible under the scrim — so without
 * a trap, tabbing past the last button silently hands the keyboard to controls
 * the user cannot see. On a dialog that approves accounts or reveals a
 * credential, that is not a cosmetic problem.
 */
const renderModal = (props: Partial<React.ComponentProps<typeof Modal>> = {}) =>
  render(
    <LanguageProvider>
      <Modal isOpen onClose={vi.fn()} title="A dialog" {...props}>
        <button type="button">first</button>
        <button type="button">second</button>
      </Modal>
    </LanguageProvider>,
  );

describe('Modal', () => {
  it('moves focus into the dialog when it opens', () => {
    renderModal();

    // Not left on whatever was focused behind the scrim.
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('restores focus to whatever opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { rerender } = renderModal();
    expect(document.activeElement).not.toBe(opener);

    rerender(
      <LanguageProvider>
        <Modal isOpen={false} onClose={vi.fn()} title="A dialog">
          <button type="button">first</button>
        </Modal>
      </LanguageProvider>,
    );

    // The keyboard lands back where the user left it, not at the top of the page.
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('wraps Tab from the last control back to the first', () => {
    renderModal();

    const focusable = Array.from(
      screen.getByRole('dialog').querySelectorAll<HTMLElement>('button'),
    );
    const last = focusable[focusable.length - 1];
    last.focus();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(document.activeElement).toBe(focusable[0]);
  });

  it('wraps Shift+Tab from the first control back to the last', () => {
    renderModal();

    const focusable = Array.from(
      screen.getByRole('dialog').querySelectorAll<HTMLElement>('button'),
    );
    focusable[0].focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks page scroll while open and restores it after', () => {
    const { rerender } = renderModal();
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <LanguageProvider>
        <Modal isOpen={false} onClose={vi.fn()} title="A dialog">
          <button type="button">first</button>
        </Modal>
      </LanguageProvider>,
    );

    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('stops listening once closed', () => {
    const onClose = vi.fn();
    const { rerender } = renderModal({ onClose });

    rerender(
      <LanguageProvider>
        <Modal isOpen={false} onClose={onClose} title="A dialog">
          <button type="button">first</button>
        </Modal>
      </LanguageProvider>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    // A listener that outlives the dialog would close the NEXT one too.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('names its close button in the current language', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
  });
  /**
   * ⚠ REGRESSION: this effect used to depend on `onClose`.
   *
   * Every caller passes a fresh arrow, so the trap was rebuilt on each render of
   * the parent — teardown restoring focus to the opener, setup taking it to the
   * dialog. Inside a form that meant a controlled input lost focus on every
   * keystroke. Nothing remounted; focus was simply being taken.
   */
  it('leaves focus alone when only the `onClose` identity changes', () => {
    const { rerender } = renderModal();

    const first = screen.getByRole('button', { name: 'first' });
    first.focus();
    expect(document.activeElement).toBe(first);

    // What a parent re-render looks like from here: same dialog, new closure.
    rerender(
      <LanguageProvider>
        <Modal isOpen onClose={vi.fn()} title="A dialog">
          <button type="button">first</button>
          <button type="button">second</button>
        </Modal>
      </LanguageProvider>,
    );

    expect(document.activeElement).toBe(first);
  });

  it('closes on Escape with the newest `onClose`, not the one from mount', () => {
    const stale = vi.fn();
    const current = vi.fn();
    const { rerender } = renderModal({ onClose: stale });

    rerender(
      <LanguageProvider>
        <Modal isOpen onClose={current} title="A dialog">
          <button type="button">first</button>
          <button type="button">second</button>
        </Modal>
      </LanguageProvider>,
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    // The ref is what keeps the handler current now that the effect no longer
    // re-runs to capture a new closure.
    expect(current).toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
  });
});
