import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Everything focusable, in document order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A centred dialog with a scrim, a scrolling body and a pinned footer.
 *
 * ★ FOCUS IS TRAPPED, AND THAT IS NOT DECORATION. Without it, Tab walks out of
 * the dialog and into the page behind — which is still rendered, still
 * clickable to a keyboard, and completely invisible under the scrim. Somebody
 * tabbing past the last button ends up operating controls they cannot see. So
 * focus moves into the dialog on open, cycles inside it, and returns to
 * whatever opened it on close.
 *
 * Escape closes, the scrim closes, body scroll is locked while open, and every
 * listener is removed on cleanup.
 */
export function Modal({ isOpen, onClose, title, children, footer, className }: Readonly<ModalProps>) {
  const { t } = useLanguage();
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;

    // Whatever had focus before this opened — restored on the way out, so the
    // keyboard lands back where the user left it rather than at the top of the
    // document.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      // No `offsetParent` visibility filter: it is null for every descendant
      // of a `position: fixed` container — which is exactly what this dialog
      // is — so it would report an empty list in a real browser and disable
      // the trap entirely. The selector already excludes disabled controls and
      // anything deliberately taken out of the tab order.
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => !element.closest('[aria-hidden="true"]'));
      // Nothing to move between: keep focus on the dialog itself rather than
      // letting Tab escape to the page underneath.
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Scrim. `aria-hidden` because the close affordance it duplicates is the
          button below, which screen readers should reach instead. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <dialog
        open
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-50 w-full max-w-lg bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]',
          'animate-in fade-in zoom-in-95 duration-200',
          className,
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ml-auto"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">{t('closeLabel')}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-xl flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </dialog>
    </div>
  );
}
